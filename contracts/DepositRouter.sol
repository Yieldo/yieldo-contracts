// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract DepositRouter is Initializable, EIP712Upgradeable, ReentrancyGuard, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 private constant DEPOSIT_INTENT_TYPEHASH =
        keccak256(
            "DepositIntent(address user,address vault,address asset,uint256 amount,uint256 nonce,uint256 deadline)"
        );

    struct DepositIntent {
        address user;
        address vault;
        address asset;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    struct DepositRecord {
        address user;
        address vault;
        address asset;
        uint256 amount;
        uint256 deadline;
        uint256 timestamp;
        bool executed;
        bool cancelled;
    }

    mapping(address => uint256) public nonces;
    mapping(bytes32 => DepositRecord) public deposits;
    mapping(address => mapping(address => uint256)) public referralEarnings;

    address public FEE_COLLECTOR;
    uint256 public constant FEE_BPS = 10;

    address public owner;
    IPyth public pyth;
    mapping(address => bytes32) public priceFeedIds;
    uint256 public maxSlippageBps;
    uint256 public minDepositUsd;
    uint256 public constant PRICE_MAX_AGE = 300;

    event DepositIntentCreated(
        bytes32 indexed intentHash,
        address indexed user,
        address indexed vault,
        address asset,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    );

    event DepositExecuted(
        bytes32 indexed intentHash,
        address indexed user,
        address indexed vault,
        uint256 amount,
        uint256 usdValue
    );

    event DepositIntentCancelled(
        bytes32 indexed intentHash,
        address indexed user
    );

    event FeeCollected(
        bytes32 indexed intentHash,
        address indexed asset,
        uint256 feeAmount
    );

    event DepositRequestSubmitted(
        bytes32 indexed intentHash,
        address indexed user,
        address indexed vault,
        uint256 amount,
        uint256 requestId
    );

    event CrossChainDepositExecuted(
        bytes32 indexed intentHash,
        address indexed user,
        address indexed vault,
        uint256 amount,
        address executor,
        uint256 usdValue
    );

    event ReferralFeeCollected(
        bytes32 indexed intentHash,
        address indexed referrer,
        address indexed asset,
        uint256 feeAmount
    );

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PythUpdated(address indexed newPyth);
    event PriceFeedSet(address indexed asset, bytes32 feedId);
    event MaxSlippageUpdated(uint256 newSlippageBps);
    event MinDepositUsdUpdated(uint256 newMinDepositUsd);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _feeCollector, address _pyth) external initializer {
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_pyth != address(0), "Invalid pyth address");

        __EIP712_init("DepositRouter", "1");

        FEE_COLLECTOR = _feeCollector;
        pyth = IPyth(_pyth);
        owner = msg.sender;
        maxSlippageBps = 200;
        minDepositUsd = 10e18;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");
        (bool success, ) = owner.call{value: balance}("");
        require(success, "ETH transfer failed");
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPyth(address _pyth) external onlyOwner {
        require(_pyth != address(0), "Invalid pyth address");
        pyth = IPyth(_pyth);
        emit PythUpdated(_pyth);
    }

    function setPriceFeed(address asset, bytes32 feedId) external onlyOwner {
        priceFeedIds[asset] = feedId;
        emit PriceFeedSet(asset, feedId);
    }

    function setPriceFeedsBatch(address[] calldata assets, bytes32[] calldata feedIds) external onlyOwner {
        require(assets.length == feedIds.length, "Length mismatch");
        for (uint256 i = 0; i < assets.length; i++) {
            priceFeedIds[assets[i]] = feedIds[i];
            emit PriceFeedSet(assets[i], feedIds[i]);
        }
    }

    function setMaxSlippage(uint256 _maxSlippageBps) external onlyOwner {
        require(_maxSlippageBps <= 1000, "Slippage too high");
        maxSlippageBps = _maxSlippageBps;
        emit MaxSlippageUpdated(_maxSlippageBps);
    }

    function setMinDepositUsd(uint256 _minDepositUsd) external onlyOwner {
        minDepositUsd = _minDepositUsd;
        emit MinDepositUsdUpdated(_minDepositUsd);
    }

    function _getUsdValue(address asset, uint256 amount) internal view returns (uint256) {
        bytes32 feedId = priceFeedIds[asset];
        if (feedId == bytes32(0)) return 0;

        PythStructs.Price memory price = pyth.getPriceNoOlderThan(feedId, PRICE_MAX_AGE);
        require(price.price > 0, "Invalid price");

        uint256 absPrice = uint256(uint64(price.price));
        uint8 assetDecimals = IERC20Metadata(asset).decimals();

        uint256 numerator = amount * absPrice;
        int256 shift = int256(uint256(assetDecimals)) + int256(int32(-price.expo)) - 18;

        if (shift > 0) {
            return numerator / (10 ** uint256(shift));
        } else if (shift < 0) {
            return numerator * (10 ** uint256(-shift));
        } else {
            return numerator;
        }
    }

    function _collectFee(
        bytes32 intentHash,
        address asset,
        uint256 feeAmount,
        address referrer
    ) internal {
        if (feeAmount == 0) return;

        if (referrer != address(0)) {
            uint256 referralFee = feeAmount / 2;
            uint256 protocolFee = feeAmount - referralFee;
            IERC20(asset).safeTransfer(referrer, referralFee);
            IERC20(asset).safeTransfer(FEE_COLLECTOR, protocolFee);
            referralEarnings[referrer][asset] += referralFee;
            emit ReferralFeeCollected(intentHash, referrer, asset, referralFee);
        } else {
            IERC20(asset).safeTransfer(FEE_COLLECTOR, feeAmount);
        }
        emit FeeCollected(intentHash, asset, feeAmount);
    }

    function getReferralEarnings(address referrer, address asset) external view returns (uint256) {
        return referralEarnings[referrer][asset];
    }

    function createDepositIntent(
        DepositIntent calldata intent,
        bytes calldata signature
    ) external returns (bytes32 intentHash) {
        require(intent.user != address(0), "Invalid user address");
        require(intent.vault != address(0), "Invalid vault address");
        require(intent.asset != address(0), "Invalid asset address");
        require(intent.amount > 0, "Amount must be greater than 0");
        require(verifyIntent(intent, signature), "Invalid signature");
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(intent.nonce == nonces[intent.user], "Invalid nonce");

        nonces[intent.user]++;

        intentHash = keccak256(
            abi.encode(
                DEPOSIT_INTENT_TYPEHASH,
                intent.user,
                intent.vault,
                intent.asset,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );

        require(deposits[intentHash].user == address(0), "Intent already exists");

        deposits[intentHash] = DepositRecord({
            user: intent.user,
            vault: intent.vault,
            asset: intent.asset,
            amount: intent.amount,
            deadline: intent.deadline,
            timestamp: block.timestamp,
            executed: false,
            cancelled: false
        });

        emit DepositIntentCreated(
            intentHash,
            intent.user,
            intent.vault,
            intent.asset,
            intent.amount,
            intent.nonce,
            intent.deadline
        );

        return intentHash;
    }

    function depositWithIntent(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer
    ) external nonReentrant returns (bytes32 intentHash) {
        return _depositWithIntent(intent, signature, false, referrer);
    }

    function depositWithIntentERC4626(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer
    ) external nonReentrant returns (bytes32 intentHash) {
        return _depositWithIntent(intent, signature, true, referrer);
    }

    function _depositWithIntent(
        DepositIntent calldata intent,
        bytes calldata signature,
        bool isERC4626,
        address referrer
    ) internal returns (bytes32 intentHash) {
        require(intent.user != address(0), "Invalid user address");
        require(intent.vault != address(0), "Invalid vault address");
        require(intent.asset != address(0), "Invalid asset address");
        require(intent.amount > 0, "Amount must be greater than 0");
        require(verifyIntent(intent, signature), "Invalid signature");
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(intent.nonce == nonces[intent.user], "Invalid nonce");

        nonces[intent.user]++;

        intentHash = keccak256(
            abi.encode(
                DEPOSIT_INTENT_TYPEHASH,
                intent.user,
                intent.vault,
                intent.asset,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );

        require(deposits[intentHash].user == address(0), "Intent already exists");

        deposits[intentHash] = DepositRecord({
            user: intent.user,
            vault: intent.vault,
            asset: intent.asset,
            amount: intent.amount,
            deadline: intent.deadline,
            timestamp: block.timestamp,
            executed: true,
            cancelled: false
        });

        emit DepositIntentCreated(
            intentHash,
            intent.user,
            intent.vault,
            intent.asset,
            intent.amount,
            intent.nonce,
            intent.deadline
        );

        IERC20(intent.asset).safeTransferFrom(
            intent.user,
            address(this),
            intent.amount
        );

        uint256 feeAmount = (intent.amount * FEE_BPS) / 10000;
        uint256 depositAmount = intent.amount - feeAmount;

        _collectFee(intentHash, intent.asset, feeAmount, referrer);

        uint256 usdValue = _getUsdValue(intent.asset, depositAmount);

        IERC20(intent.asset).forceApprove(intent.vault, depositAmount);

        bool success;
        bytes memory returnData;

        if (isERC4626) {
            (success, returnData) = intent.vault.call(
                abi.encodeWithSignature(
                    "deposit(uint256,address)",
                    depositAmount,
                    intent.user
                )
            );
        } else {
            (success, returnData) = intent.vault.call(
                abi.encodeWithSignature(
                    "syncDeposit(uint256,address,address)",
                    depositAmount,
                    intent.user,
                    address(0)
                )
            );
        }

        if (!success) {
            string memory errorMessage = isERC4626 ? "ERC4626 deposit failed" : "Vault deposit failed";

            if (returnData.length > 0) {
                if (returnData.length >= 4 &&
                    returnData[0] == 0x08 &&
                    returnData[1] == 0xc3 &&
                    returnData[2] == 0x79 &&
                    returnData[3] == 0xa0) {
                    if (returnData.length >= 68) {
                        uint256 errorLength;
                        assembly {
                            errorLength := mload(add(returnData, 0x24))
                        }
                        if (errorLength > 0 && errorLength <= returnData.length - 68) {
                            bytes memory errorBytes = new bytes(errorLength);
                            for (uint256 i = 0; i < errorLength; i++) {
                                errorBytes[i] = returnData[i + 68];
                            }
                            errorMessage = string(errorBytes);
                        }
                    }
                } else {
                    errorMessage = isERC4626 ? "ERC4626 deposit failed: custom error" : "Vault deposit failed: custom error";
                }
            }

            revert(errorMessage);
        }

        IERC20(intent.asset).forceApprove(intent.vault, 0);

        emit DepositExecuted(intentHash, intent.user, intent.vault, depositAmount, usdValue);

        return intentHash;
    }

    function depositWithIntentRequest(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer
    ) external nonReentrant returns (bytes32 intentHash, uint256 requestId) {
        require(intent.user != address(0), "Invalid user address");
        require(intent.vault != address(0), "Invalid vault address");
        require(intent.asset != address(0), "Invalid asset address");
        require(intent.amount > 0, "Amount must be greater than 0");
        require(verifyIntent(intent, signature), "Invalid signature");
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(intent.nonce == nonces[intent.user], "Invalid nonce");

        nonces[intent.user]++;

        intentHash = keccak256(
            abi.encode(
                DEPOSIT_INTENT_TYPEHASH,
                intent.user,
                intent.vault,
                intent.asset,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );

        require(deposits[intentHash].user == address(0), "Intent already exists");

        deposits[intentHash] = DepositRecord({
            user: intent.user,
            vault: intent.vault,
            asset: intent.asset,
            amount: intent.amount,
            deadline: intent.deadline,
            timestamp: block.timestamp,
            executed: true,
            cancelled: false
        });

        emit DepositIntentCreated(
            intentHash,
            intent.user,
            intent.vault,
            intent.asset,
            intent.amount,
            intent.nonce,
            intent.deadline
        );

        IERC20(intent.asset).safeTransferFrom(
            intent.user,
            address(this),
            intent.amount
        );

        uint256 feeAmount = (intent.amount * FEE_BPS) / 10000;
        uint256 depositAmount = intent.amount - feeAmount;

        _collectFee(intentHash, intent.asset, feeAmount, referrer);

        IERC20(intent.asset).forceApprove(intent.vault, depositAmount);

        (bool success, bytes memory returnData) = intent.vault.call(
            abi.encodeWithSignature(
                "requestDeposit(uint256,address,address)",
                depositAmount,
                intent.user,
                address(this)
            )
        );

        IERC20(intent.asset).forceApprove(intent.vault, 0);

        if (!success) {
            string memory errorMessage = "Vault requestDeposit failed";
            if (returnData.length >= 4) {
                if (returnData.length >= 68 &&
                    returnData[0] == 0x08 && returnData[1] == 0xc3 &&
                    returnData[2] == 0x79 && returnData[3] == 0xa0) {
                    uint256 errLen;
                    assembly { errLen := mload(add(returnData, 0x24)) }
                    if (errLen > 0 && errLen <= returnData.length - 68) {
                        bytes memory errBytes = new bytes(errLen);
                        for (uint256 i = 0; i < errLen; i++) {
                            errBytes[i] = returnData[i + 68];
                        }
                        errorMessage = string(errBytes);
                    }
                } else {
                    errorMessage = "Vault requestDeposit failed: custom error";
                }
            }
            revert(errorMessage);
        }

        require(returnData.length >= 32, "Invalid requestDeposit return");
        requestId = abi.decode(returnData, (uint256));

        emit DepositRequestSubmitted(intentHash, intent.user, intent.vault, depositAmount, requestId);

        return (intentHash, requestId);
    }

    function executeDeposit(bytes32 intentHash, address referrer) external nonReentrant {
        DepositRecord storage record = deposits[intentHash];

        require(record.user != address(0), "Intent not found");
        require(!record.executed, "Intent already executed");
        require(!record.cancelled, "Intent was cancelled");
        require(block.timestamp <= record.deadline, "Intent expired");

        record.executed = true;

        IERC20(record.asset).safeTransferFrom(
            record.user,
            address(this),
            record.amount
        );

        uint256 feeAmount = (record.amount * FEE_BPS) / 10000;
        uint256 depositAmount = record.amount - feeAmount;

        _collectFee(intentHash, record.asset, feeAmount, referrer);

        uint256 usdValue = _getUsdValue(record.asset, depositAmount);

        IERC20(record.asset).forceApprove(record.vault, depositAmount);

        (bool success, bytes memory returnData) = record.vault.call(
            abi.encodeWithSignature(
                "syncDeposit(uint256,address,address)",
                depositAmount,
                record.user,
                address(0)
            )
        );

        if (!success) {
            string memory errorMessage = "Vault deposit failed";

            if (returnData.length > 0) {
                if (returnData.length >= 4 &&
                    returnData[0] == 0x08 &&
                    returnData[1] == 0xc3 &&
                    returnData[2] == 0x79 &&
                    returnData[3] == 0xa0) {
                    if (returnData.length >= 68) {
                        uint256 errorLength;
                        assembly {
                            errorLength := mload(add(returnData, 0x24))
                        }
                        if (errorLength > 0 && errorLength <= returnData.length - 68) {
                            bytes memory errorBytes = new bytes(errorLength);
                            for (uint256 i = 0; i < errorLength; i++) {
                                errorBytes[i] = returnData[i + 68];
                            }
                            errorMessage = string(errorBytes);
                        }
                    }
                } else {
                    errorMessage = "Vault deposit failed: custom error";
                }
            }

            revert(errorMessage);
        }

        IERC20(record.asset).forceApprove(record.vault, 0);

        emit DepositExecuted(intentHash, record.user, record.vault, depositAmount, usdValue);
    }

    function cancelIntent(bytes32 intentHash) external {
        DepositRecord storage record = deposits[intentHash];

        require(record.user != address(0), "Intent not found");
        require(record.user == msg.sender, "Only user can cancel");
        require(!record.executed, "Intent already executed");
        require(!record.cancelled, "Intent already cancelled");

        record.cancelled = true;

        emit DepositIntentCancelled(intentHash, msg.sender);
    }

    function depositWithIntentCrossChain(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer,
        bytes[] calldata priceUpdate
    ) external payable nonReentrant returns (bytes32 intentHash) {
        return _depositWithIntentCrossChain(intent, signature, false, referrer, priceUpdate);
    }

    function depositWithIntentCrossChainERC4626(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer,
        bytes[] calldata priceUpdate
    ) external payable nonReentrant returns (bytes32 intentHash) {
        return _depositWithIntentCrossChain(intent, signature, true, referrer, priceUpdate);
    }

    function _depositWithIntentCrossChain(
        DepositIntent calldata intent,
        bytes calldata signature,
        bool isERC4626,
        address referrer,
        bytes[] calldata priceUpdate
    ) internal returns (bytes32 intentHash) {
        if (priceUpdate.length > 0) {
            uint256 updateFee = pyth.getUpdateFee(priceUpdate);
            pyth.updatePriceFeeds{value: updateFee}(priceUpdate);
        }

        require(intent.user != address(0), "Invalid user address");
        require(intent.vault != address(0), "Invalid vault address");
        require(intent.asset != address(0), "Invalid asset address");
        require(intent.amount > 0, "Amount must be greater than 0");
        require(verifyIntent(intent, signature), "Invalid signature");
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(intent.nonce == nonces[intent.user], "Invalid nonce");

        nonces[intent.user]++;

        intentHash = keccak256(
            abi.encode(
                DEPOSIT_INTENT_TYPEHASH,
                intent.user,
                intent.vault,
                intent.asset,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );

        require(deposits[intentHash].user == address(0), "Intent already exists");

        deposits[intentHash] = DepositRecord({
            user: intent.user,
            vault: intent.vault,
            asset: intent.asset,
            amount: intent.amount,
            deadline: intent.deadline,
            timestamp: block.timestamp,
            executed: true,
            cancelled: false
        });

        emit DepositIntentCreated(
            intentHash,
            intent.user,
            intent.vault,
            intent.asset,
            intent.amount,
            intent.nonce,
            intent.deadline
        );

        uint256 contractBalance = IERC20(intent.asset).balanceOf(address(this));

        if (contractBalance == 0) {
            uint256 allowance = IERC20(intent.asset).allowance(msg.sender, address(this));
            if (allowance >= intent.amount) {
                IERC20(intent.asset).safeTransferFrom(msg.sender, address(this), intent.amount);
                contractBalance = intent.amount;
            } else if (allowance > 0) {
                IERC20(intent.asset).safeTransferFrom(msg.sender, address(this), allowance);
                contractBalance = allowance;
            } else {
                revert("No tokens received and no allowance from caller");
            }
        }

        uint256 actualAmount = contractBalance < intent.amount ? contractBalance : intent.amount;

        if (priceFeedIds[intent.asset] != bytes32(0)) {
            uint256 expectedUsd = _getUsdValue(intent.asset, intent.amount);
            uint256 actualUsd = _getUsdValue(intent.asset, actualAmount);
            if (expectedUsd > 0) {
                require(
                    actualUsd >= (expectedUsd * (10000 - maxSlippageBps)) / 10000,
                    "Slippage exceeds limit"
                );
            }
            if (minDepositUsd > 0) {
                require(actualUsd >= minDepositUsd, "Below minimum deposit");
            }
        }

        uint256 feeAmount = (actualAmount * FEE_BPS) / 10000;
        uint256 depositAmount = actualAmount - feeAmount;

        _collectFee(intentHash, intent.asset, feeAmount, referrer);

        uint256 usdValue = _getUsdValue(intent.asset, depositAmount);

        IERC20(intent.asset).forceApprove(intent.vault, depositAmount);

        bool success;
        bytes memory returnData;

        if (isERC4626) {
            (success, returnData) = intent.vault.call(
                abi.encodeWithSignature(
                    "deposit(uint256,address)",
                    depositAmount,
                    intent.user
                )
            );
        } else {
            (success, returnData) = intent.vault.call(
                abi.encodeWithSignature(
                    "syncDeposit(uint256,address,address)",
                    depositAmount,
                    intent.user,
                    address(0)
                )
            );
        }

        if (!success) {
            string memory errorMessage = isERC4626 ? "ERC4626 deposit failed" : "Vault deposit failed";

            if (returnData.length > 0) {
                if (returnData.length >= 4 &&
                    returnData[0] == 0x08 &&
                    returnData[1] == 0xc3 &&
                    returnData[2] == 0x79 &&
                    returnData[3] == 0xa0) {
                    if (returnData.length >= 68) {
                        uint256 errorLength;
                        assembly {
                            errorLength := mload(add(returnData, 0x24))
                        }
                        if (errorLength > 0 && errorLength <= returnData.length - 68) {
                            bytes memory errorBytes = new bytes(errorLength);
                            for (uint256 i = 0; i < errorLength; i++) {
                                errorBytes[i] = returnData[i + 68];
                            }
                            errorMessage = string(errorBytes);
                        }
                    }
                } else {
                    errorMessage = isERC4626 ? "ERC4626 deposit failed: custom error" : "Vault deposit failed: custom error";
                }
            }

            revert(errorMessage);
        }

        IERC20(intent.asset).forceApprove(intent.vault, 0);

        emit DepositExecuted(intentHash, intent.user, intent.vault, depositAmount, usdValue);
        emit CrossChainDepositExecuted(intentHash, intent.user, intent.vault, depositAmount, msg.sender, usdValue);

        return intentHash;
    }

    function depositWithIntentCrossChainRequest(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer,
        bytes[] calldata priceUpdate
    ) external payable nonReentrant returns (bytes32 intentHash, uint256 requestId) {
        if (priceUpdate.length > 0) {
            uint256 updateFee = pyth.getUpdateFee(priceUpdate);
            pyth.updatePriceFeeds{value: updateFee}(priceUpdate);
        }

        require(intent.user != address(0), "Invalid user address");
        require(intent.vault != address(0), "Invalid vault address");
        require(intent.asset != address(0), "Invalid asset address");
        require(intent.amount > 0, "Amount must be greater than 0");
        require(verifyIntent(intent, signature), "Invalid signature");
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(intent.nonce == nonces[intent.user], "Invalid nonce");

        nonces[intent.user]++;

        intentHash = keccak256(
            abi.encode(
                DEPOSIT_INTENT_TYPEHASH,
                intent.user,
                intent.vault,
                intent.asset,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );

        require(deposits[intentHash].user == address(0), "Intent already exists");

        deposits[intentHash] = DepositRecord({
            user: intent.user,
            vault: intent.vault,
            asset: intent.asset,
            amount: intent.amount,
            deadline: intent.deadline,
            timestamp: block.timestamp,
            executed: true,
            cancelled: false
        });

        emit DepositIntentCreated(
            intentHash,
            intent.user,
            intent.vault,
            intent.asset,
            intent.amount,
            intent.nonce,
            intent.deadline
        );

        uint256 contractBalance = IERC20(intent.asset).balanceOf(address(this));

        if (contractBalance == 0) {
            uint256 allowance = IERC20(intent.asset).allowance(msg.sender, address(this));
            if (allowance >= intent.amount) {
                IERC20(intent.asset).safeTransferFrom(msg.sender, address(this), intent.amount);
                contractBalance = intent.amount;
            } else if (allowance > 0) {
                IERC20(intent.asset).safeTransferFrom(msg.sender, address(this), allowance);
                contractBalance = allowance;
            } else {
                revert("No tokens received and no allowance from caller");
            }
        }

        uint256 actualAmount = contractBalance < intent.amount ? contractBalance : intent.amount;

        if (priceFeedIds[intent.asset] != bytes32(0)) {
            uint256 expectedUsd = _getUsdValue(intent.asset, intent.amount);
            uint256 actualUsd = _getUsdValue(intent.asset, actualAmount);
            if (expectedUsd > 0) {
                require(
                    actualUsd >= (expectedUsd * (10000 - maxSlippageBps)) / 10000,
                    "Slippage exceeds limit"
                );
            }
            if (minDepositUsd > 0) {
                require(actualUsd >= minDepositUsd, "Below minimum deposit");
            }
        }

        uint256 feeAmount = (actualAmount * FEE_BPS) / 10000;
        uint256 depositAmount = actualAmount - feeAmount;

        _collectFee(intentHash, intent.asset, feeAmount, referrer);

        uint256 usdValue = _getUsdValue(intent.asset, depositAmount);

        IERC20(intent.asset).forceApprove(intent.vault, depositAmount);

        (bool success, bytes memory returnData) = intent.vault.call(
            abi.encodeWithSignature(
                "requestDeposit(uint256,address,address)",
                depositAmount,
                intent.user,
                address(this)
            )
        );

        IERC20(intent.asset).forceApprove(intent.vault, 0);

        if (!success) {
            string memory errorMessage = "Vault requestDeposit failed";
            if (returnData.length >= 4) {
                if (returnData.length >= 68 &&
                    returnData[0] == 0x08 && returnData[1] == 0xc3 &&
                    returnData[2] == 0x79 && returnData[3] == 0xa0) {
                    uint256 errLen;
                    assembly { errLen := mload(add(returnData, 0x24)) }
                    if (errLen > 0 && errLen <= returnData.length - 68) {
                        bytes memory errBytes = new bytes(errLen);
                        for (uint256 i = 0; i < errLen; i++) {
                            errBytes[i] = returnData[i + 68];
                        }
                        errorMessage = string(errBytes);
                    }
                } else {
                    errorMessage = "Vault requestDeposit failed: custom error";
                }
            }
            revert(errorMessage);
        }

        require(returnData.length >= 32, "Invalid requestDeposit return");
        requestId = abi.decode(returnData, (uint256));

        emit DepositRequestSubmitted(intentHash, intent.user, intent.vault, depositAmount, requestId);
        emit CrossChainDepositExecuted(intentHash, intent.user, intent.vault, depositAmount, msg.sender, usdValue);

        return (intentHash, requestId);
    }

    function verifyIntent(
        DepositIntent calldata intent,
        bytes calldata signature
    ) public view returns (bool) {
        bytes32 structHash = keccak256(
            abi.encode(
                DEPOSIT_INTENT_TYPEHASH,
                intent.user,
                intent.vault,
                intent.asset,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );

        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, signature);

        return signer == intent.user;
    }

    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    function getDeposit(bytes32 intentHash)
        external
        view
        returns (DepositRecord memory)
    {
        return deposits[intentHash];
    }

    function isIntentValid(bytes32 intentHash) external view returns (bool) {
        DepositRecord storage record = deposits[intentHash];
        return (
            record.user != address(0) &&
            !record.executed &&
            !record.cancelled &&
            block.timestamp <= record.deadline
        );
    }

    function getUsdValue(address asset, uint256 amount) external view returns (uint256) {
        return _getUsdValue(asset, amount);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getImplementation() external view returns (address) {
        return ERC1967Utils.getImplementation();
    }

    receive() external payable {}
}
