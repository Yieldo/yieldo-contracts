// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import "./interfaces/IPriceOracle.sol";

contract DepositRouter is
    Initializable,
    EIP712Upgradeable,
    ReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    string public constant VERSION = "2.3.0";

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

    // ─── Storage layout (V1 slots 0–8 — DO NOT reorder) ─────────────────────
    mapping(address => uint256) public nonces;                                  // slot 0
    mapping(bytes32 => DepositRecord) public deposits;                          // slot 1
    mapping(address => mapping(address => uint256)) public referralEarnings;    // slot 2
    address public FEE_COLLECTOR;                                               // slot 3
    address public owner;                                                       // slot 4
    IPriceOracle public oracle;                                                 // slot 5
    mapping(address => bytes32) public priceFeedIds;                            // slot 6 (deprecated, kept for layout)
    uint256 public maxSlippageBps;                                              // slot 7
    uint256 public minDepositUsd;                                               // slot 8

    // ─── V2 storage (appended after V1) ──────────────────────────────────────
    uint256 public feeBps;
    mapping(address => bool) public allowedVaults;
    bool public vaultWhitelistEnabled;
    address public pendingOwner;
    mapping(address => address) public vedaTellers;

    uint256[44] private __gap;

    // ─── Events ──────────────────────────────────────────────────────────────

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

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OracleUpdated(address indexed newOracle);
    event FeeCollectorUpdated(address indexed newFeeCollector);
    event FeeBpsUpdated(uint256 newFeeBps);
    event MaxSlippageUpdated(uint256 newSlippageBps);
    event MinDepositUsdUpdated(uint256 newMinDepositUsd);
    event VaultWhitelistToggled(bool enabled);
    event VaultAllowlistUpdated(address indexed vault, bool allowed);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);
    event VedaTellerUpdated(address indexed vault, address indexed teller);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenVaultAllowed(address vault) {
        if (vaultWhitelistEnabled) {
            require(allowedVaults[vault], "Vault not whitelisted");
        }
        _;
    }

    // ─── Initializers ────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _feeCollector, address _oracle) external initializer {
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_oracle != address(0), "Invalid oracle address");

        __EIP712_init("DepositRouter", "1");
        __Pausable_init();

        FEE_COLLECTOR = _feeCollector;
        oracle = IPriceOracle(_oracle);
        owner = msg.sender;
        maxSlippageBps = 200;
        minDepositUsd = 10e18;
        feeBps = 10;
    }

    function reinitialize(address _oracle, uint256 _feeBps) external reinitializer(2) {
        __Pausable_init();

        require(_oracle != address(0), "Invalid oracle");
        require(_feeBps <= 1000, "Fee too high");

        oracle = IPriceOracle(_oracle);
        feeBps = _feeBps;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─── Admin: ownership (two-step) ─────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // ─── Admin: configuration ────────────────────────────────────────────────

    /// @notice Pass address(0) to disable oracle entirely.
    function setOracle(address _oracle) external onlyOwner {
        oracle = IPriceOracle(_oracle);
        emit OracleUpdated(_oracle);
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid fee collector");
        FEE_COLLECTOR = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Fee too high");
        feeBps = _feeBps;
        emit FeeBpsUpdated(_feeBps);
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

    // ─── Admin: vault whitelist ──────────────────────────────────────────────

    function setVaultWhitelistEnabled(bool _enabled) external onlyOwner {
        vaultWhitelistEnabled = _enabled;
        emit VaultWhitelistToggled(_enabled);
    }

    function setVaultAllowed(address vault, bool allowed) external onlyOwner {
        allowedVaults[vault] = allowed;
        emit VaultAllowlistUpdated(vault, allowed);
    }

    function setVaultAllowedBatch(address[] calldata vaults, bool[] calldata allowed) external onlyOwner {
        require(vaults.length == allowed.length, "Length mismatch");
        for (uint256 i = 0; i < vaults.length; i++) {
            allowedVaults[vaults[i]] = allowed[i];
            emit VaultAllowlistUpdated(vaults[i], allowed[i]);
        }
    }

    // ─── Admin: Veda Teller mapping ─────────────────────────────────────────

    /// @notice Set a Veda Teller address for a BoringVault. Pass address(0) to remove.
    function setVedaTeller(address vault, address teller) external onlyOwner {
        vedaTellers[vault] = teller;
        emit VedaTellerUpdated(vault, teller);
    }

    // ─── Admin: pause / rescue ───────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");
        (bool success, ) = owner.call{value: balance}("");
        require(success, "ETH transfer failed");
    }

    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        IERC20(token).safeTransfer(to, amount);
        emit TokensRescued(token, to, amount);
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _getFeeBps() internal view returns (uint256) {
        return feeBps > 0 ? feeBps : 10;
    }

    function _getUsdValue(address asset, uint256 amount) internal view returns (uint256) {
        if (address(oracle) == address(0)) return 0;
        if (!oracle.hasFeed(asset)) return 0;
        return oracle.getUsdValue(asset, amount);
    }

    function _collectFee(
        bytes32 intentHash,
        address asset,
        uint256 feeAmount,
        address user,
        address referrer
    ) internal {
        if (feeAmount == 0) return;

        if (referrer != address(0) && referrer != user) {
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

    function _validateIntent(DepositIntent calldata intent, bytes calldata signature) internal view {
        require(intent.user != address(0), "Invalid user address");
        require(intent.vault != address(0), "Invalid vault address");
        require(intent.asset != address(0), "Invalid asset address");
        require(intent.amount > 0, "Amount must be greater than 0");
        require(verifyIntent(intent, signature), "Invalid signature");
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(intent.nonce == nonces[intent.user], "Invalid nonce");
    }

    function _computeIntentHash(DepositIntent calldata intent) internal pure returns (bytes32) {
        return keccak256(
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
    }

    function _createRecord(
        bytes32 intentHash,
        DepositIntent calldata intent,
        bool executed
    ) internal {
        require(deposits[intentHash].user == address(0), "Intent already exists");

        nonces[intent.user]++;

        deposits[intentHash] = DepositRecord({
            user: intent.user,
            vault: intent.vault,
            asset: intent.asset,
            amount: intent.amount,
            deadline: intent.deadline,
            timestamp: block.timestamp,
            executed: executed,
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
    }

    function _executeVaultCall(
        address vault,
        address asset,
        uint256 depositAmount,
        address recipient,
        bool isERC4626
    ) internal {
        address teller = vedaTellers[vault];

        if (teller != address(0)) {
            // Veda BoringVault: approve vault (not teller), call teller.deposit
            IERC20(asset).forceApprove(vault, depositAmount);

            (bool success, bytes memory returnData) = teller.call(
                abi.encodeWithSignature(
                    "deposit(address,uint256,uint256)",
                    asset,
                    depositAmount,
                    0
                )
            );

            if (!success) {
                _revertWithReason(returnData, "Veda deposit failed");
            }

            // Shares are minted to this contract — transfer to recipient
            uint256 shares = abi.decode(returnData, (uint256));
            if (shares > 0) {
                IERC20(vault).safeTransfer(recipient, shares);
            }

            IERC20(asset).forceApprove(vault, 0);
        } else {
            IERC20(asset).forceApprove(vault, depositAmount);

            bool success;
            bytes memory returnData;

            if (isERC4626) {
                (success, returnData) = vault.call(
                    abi.encodeWithSignature("deposit(uint256,address)", depositAmount, recipient)
                );
            } else {
                (success, returnData) = vault.call(
                    abi.encodeWithSignature(
                        "syncDeposit(uint256,address,address)",
                        depositAmount,
                        recipient,
                        address(0)
                    )
                );
            }

            if (!success) {
                _revertWithReason(returnData, isERC4626 ? "ERC4626 deposit failed" : "Vault deposit failed");
            }

            IERC20(asset).forceApprove(vault, 0);
        }
    }

    function _executeVaultRequestCall(
        address vault,
        address asset,
        uint256 depositAmount,
        address recipient
    ) internal returns (uint256 requestId) {
        IERC20(asset).forceApprove(vault, depositAmount);

        (bool success, bytes memory returnData) = vault.call(
            abi.encodeWithSignature(
                "requestDeposit(uint256,address,address)",
                depositAmount,
                recipient,
                address(this)
            )
        );

        IERC20(asset).forceApprove(vault, 0);

        if (!success) {
            _revertWithReason(returnData, "Vault requestDeposit failed");
        }

        require(returnData.length >= 32, "Invalid requestDeposit return");
        requestId = abi.decode(returnData, (uint256));
    }

    function _revertWithReason(bytes memory returnData, string memory fallbackMsg) internal pure {
        if (
            returnData.length >= 68 &&
            returnData[0] == 0x08 && returnData[1] == 0xc3 &&
            returnData[2] == 0x79 && returnData[3] == 0xa0
        ) {
            uint256 errorLength;
            assembly { errorLength := mload(add(returnData, 0x24)) }
            if (errorLength > 0 && errorLength <= returnData.length - 68) {
                bytes memory errorBytes = new bytes(errorLength);
                for (uint256 i = 0; i < errorLength; i++) {
                    errorBytes[i] = returnData[i + 68];
                }
                revert(string(errorBytes));
            }
        }
        revert(fallbackMsg);
    }

    function _validateSlippageAndMinDeposit(address asset, uint256 expectedAmount, uint256 actualAmount) internal view {
        if (address(oracle) != address(0) && oracle.hasFeed(asset)) {
            uint256 expectedUsd = oracle.getUsdValue(asset, expectedAmount);
            uint256 actualUsd = oracle.getUsdValue(asset, actualAmount);
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
    }

    /// @dev Acquires tokens for cross-chain deposits. Supports LiFi (tokens pre-transferred
    /// to this contract) and approve-based patterns. Reverts if insufficient tokens available.
    function _pullCrossChainTokens(address asset, uint256 intentAmount) internal returns (uint256) {
        uint256 contractBalance = IERC20(asset).balanceOf(address(this));

        if (contractBalance >= intentAmount) {
            return intentAmount;
        }

        uint256 needed = intentAmount - contractBalance;
        uint256 allowance = IERC20(asset).allowance(msg.sender, address(this));
        require(allowance >= needed, "Insufficient allowance from caller");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), needed);

        return intentAmount;
    }

    function _handlePriceUpdate(bytes[] calldata priceUpdate) internal {
        if (priceUpdate.length > 0 && address(oracle) != address(0)) {
            (bool feeOk, bytes memory feeData) = address(oracle).staticcall(
                abi.encodeWithSignature("getUpdateFee(bytes[])", priceUpdate)
            );
            require(feeOk && feeData.length >= 32, "Fee query failed");
            uint256 updateFee = abi.decode(feeData, (uint256));

            require(address(this).balance >= updateFee, "Insufficient ETH for price update");
            (bool success, ) = address(oracle).call{value: updateFee}(
                abi.encodeWithSignature("updatePriceFeeds(bytes[])", priceUpdate)
            );
            require(success, "Price update failed");

            if (msg.value > updateFee) {
                uint256 excess = msg.value - updateFee;
                (bool refundSuccess, ) = msg.sender.call{value: excess}("");
                require(refundSuccess, "ETH refund failed");
            }
        }
    }

    // ─── Public: intent creation ─────────────────────────────────────────────

    function createDepositIntent(
        DepositIntent calldata intent,
        bytes calldata signature
    ) external whenNotPaused returns (bytes32 intentHash) {
        _validateIntent(intent, signature);
        intentHash = _computeIntentHash(intent);
        _createRecord(intentHash, intent, false);
        return intentHash;
    }

    // ─── Public: same-chain deposits ─────────────────────────────────────────

    function depositWithIntent(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer
    ) external nonReentrant whenNotPaused whenVaultAllowed(intent.vault) returns (bytes32 intentHash) {
        return _depositWithIntent(intent, signature, false, referrer);
    }

    function depositWithIntentERC4626(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer
    ) external nonReentrant whenNotPaused whenVaultAllowed(intent.vault) returns (bytes32 intentHash) {
        return _depositWithIntent(intent, signature, true, referrer);
    }

    function _depositWithIntent(
        DepositIntent calldata intent,
        bytes calldata signature,
        bool isERC4626,
        address referrer
    ) internal returns (bytes32 intentHash) {
        _validateIntent(intent, signature);
        intentHash = _computeIntentHash(intent);
        _createRecord(intentHash, intent, true);

        IERC20(intent.asset).safeTransferFrom(intent.user, address(this), intent.amount);

        uint256 currentFeeBps = _getFeeBps();
        uint256 feeAmount = (intent.amount * currentFeeBps) / 10000;
        uint256 depositAmount = intent.amount - feeAmount;

        _collectFee(intentHash, intent.asset, feeAmount, intent.user, referrer);

        uint256 usdValue = _getUsdValue(intent.asset, depositAmount);

        _executeVaultCall(intent.vault, intent.asset, depositAmount, intent.user, isERC4626);

        emit DepositExecuted(intentHash, intent.user, intent.vault, depositAmount, usdValue);
        return intentHash;
    }

    // ─── Public: same-chain request deposits ─────────────────────────────────

    function depositWithIntentRequest(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer
    ) external nonReentrant whenNotPaused whenVaultAllowed(intent.vault) returns (bytes32 intentHash, uint256 requestId) {
        _validateIntent(intent, signature);
        intentHash = _computeIntentHash(intent);
        _createRecord(intentHash, intent, true);

        IERC20(intent.asset).safeTransferFrom(intent.user, address(this), intent.amount);

        uint256 currentFeeBps = _getFeeBps();
        uint256 feeAmount = (intent.amount * currentFeeBps) / 10000;
        uint256 depositAmount = intent.amount - feeAmount;

        _collectFee(intentHash, intent.asset, feeAmount, intent.user, referrer);

        requestId = _executeVaultRequestCall(intent.vault, intent.asset, depositAmount, intent.user);

        emit DepositRequestSubmitted(intentHash, intent.user, intent.vault, depositAmount, requestId);
        return (intentHash, requestId);
    }

    // ─── Public: deferred execution ──────────────────────────────────────────

    function executeDeposit(
        bytes32 intentHash,
        address referrer
    ) external nonReentrant whenNotPaused {
        DepositRecord storage record = deposits[intentHash];

        require(record.user != address(0), "Intent not found");
        require(!record.executed, "Intent already executed");
        require(!record.cancelled, "Intent was cancelled");
        require(block.timestamp <= record.deadline, "Intent expired");

        if (vaultWhitelistEnabled) {
            require(allowedVaults[record.vault], "Vault not whitelisted");
        }

        record.executed = true;

        IERC20(record.asset).safeTransferFrom(record.user, address(this), record.amount);

        uint256 currentFeeBps = _getFeeBps();
        uint256 feeAmount = (record.amount * currentFeeBps) / 10000;
        uint256 depositAmount = record.amount - feeAmount;

        _collectFee(intentHash, record.asset, feeAmount, record.user, referrer);

        uint256 usdValue = _getUsdValue(record.asset, depositAmount);

        _executeVaultCall(record.vault, record.asset, depositAmount, record.user, false);

        emit DepositExecuted(intentHash, record.user, record.vault, depositAmount, usdValue);
    }

    // ─── Public: cancel ──────────────────────────────────────────────────────

    function cancelIntent(bytes32 intentHash) external {
        DepositRecord storage record = deposits[intentHash];

        require(record.user != address(0), "Intent not found");
        require(record.user == msg.sender, "Only user can cancel");
        require(!record.executed, "Intent already executed");
        require(!record.cancelled, "Intent already cancelled");

        record.cancelled = true;
        emit DepositIntentCancelled(intentHash, msg.sender);
    }

    // ─── Public: cross-chain deposits ────────────────────────────────────────

    function depositWithIntentCrossChain(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer,
        bytes[] calldata priceUpdate
    ) external payable nonReentrant whenNotPaused whenVaultAllowed(intent.vault) returns (bytes32 intentHash) {
        return _depositWithIntentCrossChain(intent, signature, false, referrer, priceUpdate);
    }

    function depositWithIntentCrossChainERC4626(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer,
        bytes[] calldata priceUpdate
    ) external payable nonReentrant whenNotPaused whenVaultAllowed(intent.vault) returns (bytes32 intentHash) {
        return _depositWithIntentCrossChain(intent, signature, true, referrer, priceUpdate);
    }

    function _depositWithIntentCrossChain(
        DepositIntent calldata intent,
        bytes calldata signature,
        bool isERC4626,
        address referrer,
        bytes[] calldata priceUpdate
    ) internal returns (bytes32 intentHash) {
        _handlePriceUpdate(priceUpdate);

        _validateIntent(intent, signature);
        intentHash = _computeIntentHash(intent);
        _createRecord(intentHash, intent, true);

        uint256 actualAmount = _pullCrossChainTokens(intent.asset, intent.amount);

        _validateSlippageAndMinDeposit(intent.asset, intent.amount, actualAmount);

        uint256 currentFeeBps = _getFeeBps();
        uint256 feeAmount = (actualAmount * currentFeeBps) / 10000;
        uint256 depositAmount = actualAmount - feeAmount;

        _collectFee(intentHash, intent.asset, feeAmount, intent.user, referrer);

        uint256 usdValue = _getUsdValue(intent.asset, depositAmount);

        _executeVaultCall(intent.vault, intent.asset, depositAmount, intent.user, isERC4626);

        emit DepositExecuted(intentHash, intent.user, intent.vault, depositAmount, usdValue);
        emit CrossChainDepositExecuted(intentHash, intent.user, intent.vault, depositAmount, msg.sender, usdValue);
        return intentHash;
    }

    // ─── Public: cross-chain request deposits ────────────────────────────────

    function depositWithIntentCrossChainRequest(
        DepositIntent calldata intent,
        bytes calldata signature,
        address referrer,
        bytes[] calldata priceUpdate
    ) external payable nonReentrant whenNotPaused whenVaultAllowed(intent.vault) returns (bytes32 intentHash, uint256 requestId) {
        _handlePriceUpdate(priceUpdate);

        _validateIntent(intent, signature);
        intentHash = _computeIntentHash(intent);
        _createRecord(intentHash, intent, true);

        uint256 actualAmount = _pullCrossChainTokens(intent.asset, intent.amount);

        _validateSlippageAndMinDeposit(intent.asset, intent.amount, actualAmount);

        uint256 currentFeeBps = _getFeeBps();
        uint256 feeAmount = (actualAmount * currentFeeBps) / 10000;
        uint256 depositAmount = actualAmount - feeAmount;

        _collectFee(intentHash, intent.asset, feeAmount, intent.user, referrer);

        uint256 usdValue = _getUsdValue(intent.asset, depositAmount);

        requestId = _executeVaultRequestCall(intent.vault, intent.asset, depositAmount, intent.user);

        emit DepositRequestSubmitted(intentHash, intent.user, intent.vault, depositAmount, requestId);
        emit CrossChainDepositExecuted(intentHash, intent.user, intent.vault, depositAmount, msg.sender, usdValue);
        return (intentHash, requestId);
    }

    // ─── View functions ──────────────────────────────────────────────────────

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

    function getDeposit(bytes32 intentHash) external view returns (DepositRecord memory) {
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

    function getReferralEarnings(address referrer, address asset) external view returns (uint256) {
        return referralEarnings[referrer][asset];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getImplementation() external view returns (address) {
        return ERC1967Utils.getImplementation();
    }

    receive() external payable {}
}
