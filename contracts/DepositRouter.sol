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

contract DepositRouter is Initializable, EIP712Upgradeable, ReentrancyGuard, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    string public constant VERSION = "2.5.0";
    bytes32 private constant DEPOSIT_INTENT_TYPEHASH = keccak256(
        "DepositIntent(address user,address vault,address asset,uint256 amount,uint256 nonce,uint256 deadline,uint256 feeBps)"
    );

    struct DepositIntent {
        address user;
        address vault;
        address asset;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
        uint256 feeBps;
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
        uint256 feeBps;
    }

    // V1 storage (slots 0-8, DO NOT reorder)
    mapping(address => uint256) public nonces;
    mapping(bytes32 => DepositRecord) public deposits;
    mapping(address => mapping(address => uint256)) public referralEarnings;
    address public FEE_COLLECTOR;
    address public owner;
    IPriceOracle public oracle;
    mapping(address => bytes32) public priceFeedIds; // deprecated, kept for layout
    uint256 public maxSlippageBps;
    uint256 public minDepositUsd;
    // V2+ storage
    uint256 public feeBps;
    mapping(address => bool) public allowedVaults;
    bool public vaultWhitelistEnabled;
    address public pendingOwner;
    mapping(address => address) public vedaTellers;
    address public signer;
    mapping(address => address) public midasVaults;
    uint256[42] private __gap;

    event DepositIntentCreated(bytes32 indexed intentHash, address indexed user, address indexed vault, address asset, uint256 amount, uint256 nonce, uint256 deadline);
    event DepositExecuted(bytes32 indexed intentHash, address indexed user, address indexed vault, uint256 amount, uint256 usdValue);
    event DepositIntentCancelled(bytes32 indexed intentHash, address indexed user);
    event FeeCollected(bytes32 indexed intentHash, address indexed asset, uint256 feeAmount);
    event DepositRequestSubmitted(bytes32 indexed intentHash, address indexed user, address indexed vault, uint256 amount, uint256 requestId);
    event CrossChainDepositExecuted(bytes32 indexed intentHash, address indexed user, address indexed vault, uint256 amount, address executor, uint256 usdValue);
    event ReferralFeeCollected(bytes32 indexed intentHash, address indexed referrer, address indexed asset, uint256 feeAmount);
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
    event SignerUpdated(address indexed newSigner);
    event MidasVaultUpdated(address indexed token, address indexed issuanceVault);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier whenVaultAllowed(address vault) { if (vaultWhitelistEnabled) require(allowedVaults[vault], "Vault not whitelisted"); _; }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _feeCollector, address _oracle) external initializer {
        require(_feeCollector != address(0) && _oracle != address(0));
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
        require(_oracle != address(0) && _feeBps <= 1000);
        oracle = IPriceOracle(_oracle);
        feeBps = _feeBps;
    }

    function reinitializeV3(address _signer) external reinitializer(3) {
        require(_signer != address(0));
        signer = _signer;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // Admin: ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0));
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }
    function acceptOwnership() external {
        require(msg.sender == pendingOwner);
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // Admin: configuration
    function setOracle(address _oracle) external onlyOwner { oracle = IPriceOracle(_oracle); emit OracleUpdated(_oracle); }
    function setFeeCollector(address _fc) external onlyOwner { require(_fc != address(0)); FEE_COLLECTOR = _fc; emit FeeCollectorUpdated(_fc); }
    function setFeeBps(uint256 _feeBps) external onlyOwner { require(_feeBps <= 1000); feeBps = _feeBps; emit FeeBpsUpdated(_feeBps); }
    function setMaxSlippage(uint256 _bps) external onlyOwner { require(_bps <= 1000); maxSlippageBps = _bps; emit MaxSlippageUpdated(_bps); }
    function setMinDepositUsd(uint256 _min) external onlyOwner { minDepositUsd = _min; emit MinDepositUsdUpdated(_min); }
    function setVaultWhitelistEnabled(bool _e) external onlyOwner { vaultWhitelistEnabled = _e; emit VaultWhitelistToggled(_e); }
    function setVaultAllowed(address v, bool a) external onlyOwner { allowedVaults[v] = a; emit VaultAllowlistUpdated(v, a); }
    function setVaultAllowedBatch(address[] calldata v, bool[] calldata a) external onlyOwner {
        require(v.length == a.length);
        for (uint256 i = 0; i < v.length; i++) { allowedVaults[v[i]] = a[i]; emit VaultAllowlistUpdated(v[i], a[i]); }
    }
    function setVedaTeller(address vault, address teller) external onlyOwner { vedaTellers[vault] = teller; emit VedaTellerUpdated(vault, teller); }
    function setMidasVault(address token, address iv) external onlyOwner { midasVaults[token] = iv; emit MidasVaultUpdated(token, iv); }
    function setMidasVaultBatch(address[] calldata t, address[] calldata iv) external onlyOwner {
        require(t.length == iv.length);
        for (uint256 i = 0; i < t.length; i++) { midasVaults[t[i]] = iv[i]; emit MidasVaultUpdated(t[i], iv[i]); }
    }
    function setSigner(address _s) external onlyOwner { require(_s != address(0)); signer = _s; emit SignerUpdated(_s); }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function withdrawETH() external onlyOwner {
        uint256 b = address(this).balance;
        require(b > 0);
        (bool ok, ) = owner.call{value: b}("");
        require(ok);
    }
    function rescueERC20(address token, address to, uint256 amt) external onlyOwner {
        require(to != address(0));
        IERC20(token).safeTransfer(to, amt);
        emit TokensRescued(token, to, amt);
    }

    // Internal helpers
    function _getRecordFeeBps(uint256 r) internal view returns (uint256) { return r > 0 ? r : feeBps; }

    function _getUsdValue(address asset, uint256 amount) internal view returns (uint256) {
        if (address(oracle) == address(0) || !oracle.hasFeed(asset)) return 0;
        return oracle.getUsdValue(asset, amount);
    }

    function _collectFee(bytes32 ih, address asset, uint256 fee, address user, address referrer) internal {
        if (fee == 0) return;
        if (referrer != address(0) && referrer != user) {
            uint256 rFee = fee / 2;
            IERC20(asset).safeTransfer(referrer, rFee);
            IERC20(asset).safeTransfer(FEE_COLLECTOR, fee - rFee);
            referralEarnings[referrer][asset] += rFee;
            emit ReferralFeeCollected(ih, referrer, asset, rFee);
        } else {
            IERC20(asset).safeTransfer(FEE_COLLECTOR, fee);
        }
        emit FeeCollected(ih, asset, fee);
    }

    function _validateIntent(DepositIntent calldata i, bytes calldata sig) internal view {
        require(i.user != address(0) && i.vault != address(0) && i.asset != address(0));
        require(i.amount > 0 && i.feeBps <= 1000);
        require(verifyIntent(i, sig), "Invalid signature");
        require(block.timestamp <= i.deadline, "Intent expired");
        require(i.nonce == nonces[i.user], "Invalid nonce");
    }

    function _computeIntentHash(DepositIntent calldata i) internal pure returns (bytes32) {
        return keccak256(abi.encode(DEPOSIT_INTENT_TYPEHASH, i.user, i.vault, i.asset, i.amount, i.nonce, i.deadline, i.feeBps));
    }

    function _createRecord(bytes32 ih, DepositIntent calldata i, bool executed) internal {
        require(deposits[ih].user == address(0), "Intent exists");
        nonces[i.user]++;
        deposits[ih] = DepositRecord(i.user, i.vault, i.asset, i.amount, i.deadline, block.timestamp, executed, false, i.feeBps);
        emit DepositIntentCreated(ih, i.user, i.vault, i.asset, i.amount, i.nonce, i.deadline);
    }

    function _executeVaultCall(address vault, address asset, uint256 amt, address recipient, bool isERC4626) internal {
        // Midas: deposits go through separate issuance vault
        address midasIV = midasVaults[vault];
        if (midasIV != address(0)) {
            IERC20(asset).forceApprove(midasIV, amt);
            uint256 balBefore = IERC20(vault).balanceOf(address(this));
            (bool ok, bytes memory rd) = midasIV.call(abi.encodeWithSignature("depositInstant(address,uint256,uint256,bytes32)", asset, amt, 0, bytes32(0)));
            if (!ok) _revertWithReason(rd, "Midas deposit failed");
            uint256 received = IERC20(vault).balanceOf(address(this)) - balBefore;
            if (received > 0) IERC20(vault).safeTransfer(recipient, received);
            IERC20(asset).forceApprove(midasIV, 0);
            return;
        }
        // Veda BoringVault: deposits go through teller
        address teller = vedaTellers[vault];
        if (teller != address(0)) {
            IERC20(asset).forceApprove(vault, amt);
            (bool ok, bytes memory rd) = teller.call(abi.encodeWithSignature("deposit(address,uint256,uint256)", asset, amt, 0));
            if (!ok) _revertWithReason(rd, "Veda deposit failed");
            uint256 shares = abi.decode(rd, (uint256));
            if (shares > 0) IERC20(vault).safeTransfer(recipient, shares);
            IERC20(asset).forceApprove(vault, 0);
            return;
        }
        // ERC-4626 or Custom (syncDeposit)
        IERC20(asset).forceApprove(vault, amt);
        {
            bool ok; bytes memory rd;
            if (isERC4626) {
                (ok, rd) = vault.call(abi.encodeWithSignature("deposit(uint256,address)", amt, recipient));
            } else {
                (ok, rd) = vault.call(abi.encodeWithSignature("syncDeposit(uint256,address,address)", amt, recipient, address(0)));
            }
            if (!ok) _revertWithReason(rd, isERC4626 ? "ERC4626 deposit failed" : "Vault deposit failed");
        }
        IERC20(asset).forceApprove(vault, 0);
    }

    function _executeVaultRequestCall(address vault, address asset, uint256 amt, address recipient) internal returns (uint256 rid) {
        IERC20(asset).forceApprove(vault, amt);
        (bool ok, bytes memory rd) = vault.call(abi.encodeWithSignature("requestDeposit(uint256,address,address)", amt, recipient, address(this)));
        IERC20(asset).forceApprove(vault, 0);
        if (!ok) _revertWithReason(rd, "requestDeposit failed");
        require(rd.length >= 32);
        rid = abi.decode(rd, (uint256));
    }

    function _revertWithReason(bytes memory rd, string memory fb) internal pure {
        if (rd.length >= 68 && rd[0] == 0x08 && rd[1] == 0xc3 && rd[2] == 0x79 && rd[3] == 0xa0) {
            uint256 len;
            assembly { len := mload(add(rd, 0x24)) }
            if (len > 0 && len <= rd.length - 68) {
                bytes memory err = new bytes(len);
                for (uint256 i = 0; i < len; i++) err[i] = rd[i + 68];
                revert(string(err));
            }
        }
        revert(fb);
    }

    function _validateSlippageAndMinDeposit(address asset, uint256 expected, uint256 actual) internal view {
        if (address(oracle) != address(0) && oracle.hasFeed(asset)) {
            uint256 expUsd = oracle.getUsdValue(asset, expected);
            uint256 actUsd = oracle.getUsdValue(asset, actual);
            if (expUsd > 0) require(actUsd >= (expUsd * (10000 - maxSlippageBps)) / 10000, "Slippage exceeds limit");
            if (minDepositUsd > 0) require(actUsd >= minDepositUsd, "Below minimum deposit");
        }
    }

    function _pullCrossChainTokens(address asset, uint256 intentAmt) internal returns (uint256) {
        uint256 bal = IERC20(asset).balanceOf(address(this));
        if (bal >= intentAmt) return intentAmt;
        uint256 needed = intentAmt - bal;
        require(IERC20(asset).allowance(msg.sender, address(this)) >= needed, "Insufficient allowance");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), needed);
        return intentAmt;
    }

    function _handlePriceUpdate(bytes[] calldata pu) internal {
        if (pu.length > 0 && address(oracle) != address(0)) {
            (bool feeOk, bytes memory fd) = address(oracle).staticcall(abi.encodeWithSignature("getUpdateFee(bytes[])", pu));
            require(feeOk && fd.length >= 32, "Fee query failed");
            uint256 fee = abi.decode(fd, (uint256));
            require(address(this).balance >= fee, "Insufficient ETH for oracle");
            (bool ok, ) = address(oracle).call{value: fee}(abi.encodeWithSignature("updatePriceFeeds(bytes[])", pu));
            require(ok, "Price update failed");
            if (msg.value > fee) { (bool r, ) = msg.sender.call{value: msg.value - fee}(""); require(r); }
        }
    }

    // Public: intent creation
    function createDepositIntent(DepositIntent calldata i, bytes calldata sig) external whenNotPaused returns (bytes32 ih) {
        _validateIntent(i, sig);
        ih = _computeIntentHash(i);
        _createRecord(ih, i, false);
    }

    // Public: same-chain deposits
    function depositWithIntent(DepositIntent calldata i, bytes calldata sig, address ref) external nonReentrant whenNotPaused whenVaultAllowed(i.vault) returns (bytes32) {
        return _depositWithIntent(i, sig, false, ref);
    }
    function depositWithIntentERC4626(DepositIntent calldata i, bytes calldata sig, address ref) external nonReentrant whenNotPaused whenVaultAllowed(i.vault) returns (bytes32) {
        return _depositWithIntent(i, sig, true, ref);
    }
    function _depositWithIntent(DepositIntent calldata i, bytes calldata sig, bool isERC4626, address ref) internal returns (bytes32 ih) {
        _validateIntent(i, sig);
        ih = _computeIntentHash(i);
        _createRecord(ih, i, true);
        IERC20(i.asset).safeTransferFrom(i.user, address(this), i.amount);
        uint256 fee = (i.amount * i.feeBps) / 10000;
        uint256 depAmt = i.amount - fee;
        _collectFee(ih, i.asset, fee, i.user, ref);
        _executeVaultCall(i.vault, i.asset, depAmt, i.user, isERC4626);
        emit DepositExecuted(ih, i.user, i.vault, depAmt, _getUsdValue(i.asset, depAmt));
    }

    // Public: same-chain request deposits
    function depositWithIntentRequest(DepositIntent calldata i, bytes calldata sig, address ref) external nonReentrant whenNotPaused whenVaultAllowed(i.vault) returns (bytes32 ih, uint256 rid) {
        _validateIntent(i, sig);
        ih = _computeIntentHash(i);
        _createRecord(ih, i, true);
        IERC20(i.asset).safeTransferFrom(i.user, address(this), i.amount);
        uint256 fee = (i.amount * i.feeBps) / 10000;
        uint256 depAmt = i.amount - fee;
        _collectFee(ih, i.asset, fee, i.user, ref);
        rid = _executeVaultRequestCall(i.vault, i.asset, depAmt, i.user);
        emit DepositRequestSubmitted(ih, i.user, i.vault, depAmt, rid);
    }

    // Public: deferred execution
    function executeDeposit(bytes32 ih, address ref) external nonReentrant whenNotPaused {
        DepositRecord storage r = deposits[ih];
        require(r.user != address(0) && !r.executed && !r.cancelled && block.timestamp <= r.deadline);
        if (vaultWhitelistEnabled) require(allowedVaults[r.vault]);
        r.executed = true;
        IERC20(r.asset).safeTransferFrom(r.user, address(this), r.amount);
        uint256 fb = _getRecordFeeBps(r.feeBps);
        uint256 fee = (r.amount * fb) / 10000;
        uint256 depAmt = r.amount - fee;
        _collectFee(ih, r.asset, fee, r.user, ref);
        _executeVaultCall(r.vault, r.asset, depAmt, r.user, false);
        emit DepositExecuted(ih, r.user, r.vault, depAmt, _getUsdValue(r.asset, depAmt));
    }

    // Public: cancel
    function cancelIntent(bytes32 ih) external {
        DepositRecord storage r = deposits[ih];
        require(r.user != address(0) && r.user == msg.sender && !r.executed && !r.cancelled);
        r.cancelled = true;
        emit DepositIntentCancelled(ih, msg.sender);
    }

    // Public: cross-chain deposits
    function depositWithIntentCrossChain(DepositIntent calldata i, bytes calldata sig, address ref, bytes[] calldata pu) external payable nonReentrant whenNotPaused whenVaultAllowed(i.vault) returns (bytes32) {
        return _depositWithIntentCrossChain(i, sig, false, ref, pu);
    }
    function depositWithIntentCrossChainERC4626(DepositIntent calldata i, bytes calldata sig, address ref, bytes[] calldata pu) external payable nonReentrant whenNotPaused whenVaultAllowed(i.vault) returns (bytes32) {
        return _depositWithIntentCrossChain(i, sig, true, ref, pu);
    }
    function _depositWithIntentCrossChain(DepositIntent calldata i, bytes calldata sig, bool isERC4626, address ref, bytes[] calldata pu) internal returns (bytes32 ih) {
        _handlePriceUpdate(pu);
        _validateIntent(i, sig);
        ih = _computeIntentHash(i);
        _createRecord(ih, i, true);
        uint256 actual = _pullCrossChainTokens(i.asset, i.amount);
        _validateSlippageAndMinDeposit(i.asset, i.amount, actual);
        uint256 fee = (actual * i.feeBps) / 10000;
        uint256 depAmt = actual - fee;
        _collectFee(ih, i.asset, fee, i.user, ref);
        _executeVaultCall(i.vault, i.asset, depAmt, i.user, isERC4626);
        emit DepositExecuted(ih, i.user, i.vault, depAmt, _getUsdValue(i.asset, depAmt));
        emit CrossChainDepositExecuted(ih, i.user, i.vault, depAmt, msg.sender, _getUsdValue(i.asset, depAmt));
    }

    // Public: cross-chain request deposits
    function depositWithIntentCrossChainRequest(DepositIntent calldata i, bytes calldata sig, address ref, bytes[] calldata pu) external payable nonReentrant whenNotPaused whenVaultAllowed(i.vault) returns (bytes32 ih, uint256 rid) {
        _handlePriceUpdate(pu);
        _validateIntent(i, sig);
        ih = _computeIntentHash(i);
        _createRecord(ih, i, true);
        uint256 actual = _pullCrossChainTokens(i.asset, i.amount);
        _validateSlippageAndMinDeposit(i.asset, i.amount, actual);
        uint256 fee = (actual * i.feeBps) / 10000;
        uint256 depAmt = actual - fee;
        _collectFee(ih, i.asset, fee, i.user, ref);
        rid = _executeVaultRequestCall(i.vault, i.asset, depAmt, i.user);
        emit DepositRequestSubmitted(ih, i.user, i.vault, depAmt, rid);
        emit CrossChainDepositExecuted(ih, i.user, i.vault, depAmt, msg.sender, _getUsdValue(i.asset, depAmt));
    }

    // View functions
    function verifyIntent(DepositIntent calldata i, bytes calldata sig) public view returns (bool) {
        bytes32 h = _hashTypedDataV4(keccak256(abi.encode(DEPOSIT_INTENT_TYPEHASH, i.user, i.vault, i.asset, i.amount, i.nonce, i.deadline, i.feeBps)));
        return ECDSA.recover(h, sig) == signer;
    }
    function getNonce(address user) external view returns (uint256) { return nonces[user]; }
    function getDeposit(bytes32 ih) external view returns (DepositRecord memory) { return deposits[ih]; }
    function isIntentValid(bytes32 ih) external view returns (bool) {
        DepositRecord storage r = deposits[ih];
        return r.user != address(0) && !r.executed && !r.cancelled && block.timestamp <= r.deadline;
    }
    function getUsdValue(address asset, uint256 amount) external view returns (uint256) { return _getUsdValue(asset, amount); }
    function getReferralEarnings(address ref, address asset) external view returns (uint256) { return referralEarnings[ref][asset]; }
    function domainSeparator() external view returns (bytes32) { return _domainSeparatorV4(); }
    function getImplementation() external view returns (address) { return ERC1967Utils.getImplementation(); }

    receive() external payable {}
}
