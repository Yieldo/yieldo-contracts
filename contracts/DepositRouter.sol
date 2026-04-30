// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import "@openzeppelin/contracts/utils/StorageSlot.sol";
import "./interfaces/IVaultAdapter.sol";

contract DepositRouter is Initializable, ReentrancyGuard, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    string public constant VERSION = "3.3.0";

    // Storage layout — DO NOT reorder or remove; UUPS upgrade compatibility.
    // OZ v5.5+ bases (RG/Pausable/UUPS/Initializable) all use ERC-7201 namespaced
    // storage and consume no slots in the regular layout.
    mapping(address => uint256) private _deprecated_nonces;
    mapping(bytes32 => bytes32) private _deprecated_deposits;
    mapping(address => mapping(address => uint256)) private _deprecated_referralEarnings;
    address private _deprecated_feeCollector;
    address public owner;
    address private _deprecated_oracle;
    mapping(address => bytes32) private _deprecated_priceFeedIds;
    uint256 private _deprecated_maxSlippageBps;
    uint256 private _deprecated_minDepositUsd;
    uint256 private _deprecated_feeBps;
    mapping(address => bool) public allowedVaults;
    bool public vaultWhitelistEnabled;
    address public pendingOwner;
    mapping(address => address) public vedaTellers;
    address private _deprecated_signer;
    mapping(address => address) public midasVaults;
    uint16 private _deprecated_referralSplitBps;
    mapping(address => address) private _deprecated_midasRedemptionVaults;
    mapping(bytes32 => bytes32) private _deprecated_withdrawRequests;
    address private _deprecated_withdrawEscrowImpl;
    mapping(address => mapping(address => address)) public lidoDepositQueues;
    mapping(address => address) public vaultAdapters;
    mapping(address => bool) public authorizedCallers;
    address public lidoReferrer;
    bool public authChecksEnabled;
    uint256[33] private __gap;

    event Routed(
        bytes32 indexed partnerId,
        uint8 partnerType,
        address indexed user,
        address indexed vault,
        address asset,
        uint256 amount,
        uint256 shares
    );
    event DepositRequestRouted(
        bytes32 indexed partnerId,
        uint8 partnerType,
        address indexed user,
        address indexed vault,
        address asset,
        uint256 amount,
        uint256 requestId
    );
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event VaultWhitelistToggled(bool enabled);
    event VaultAllowlistUpdated(address indexed vault, bool allowed);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);
    event VedaTellerUpdated(address indexed vault, address indexed teller);
    event MidasVaultUpdated(address indexed token, address indexed issuanceVault);
    event LidoDepositQueueUpdated(address indexed vault, address indexed asset, address indexed queue);
    event VaultAdapterUpdated(address indexed vault, address indexed adapter);
    event AuthorizedCallerUpdated(address indexed caller, bool authorized);
    event LidoReferrerUpdated(address indexed referrer);
    event AuthChecksToggled(bool enabled);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier whenVaultAllowed(address vault) {
        if (vaultWhitelistEnabled) require(allowedVaults[vault], "Vault not whitelisted");
        _;
    }
    // deadline == 0 disables expiration (preserves V3.0–V3.2.x ABI through shims).
    modifier checkDeadline(uint256 deadline) {
        require(deadline == 0 || block.timestamp <= deadline, "Expired");
        _;
    }
    modifier onlyAuthorized() {
        if (authChecksEnabled) require(authorizedCallers[msg.sender], "Caller not authorized");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    // OZ v5.5+ ReentrancyGuard namespaced slot — seeded to NOT_ENTERED in init/reinit
    // because the implementation's constructor doesn't run against proxy storage.
    bytes32 private constant _RG_STORAGE = 0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    function initializeV3(address _owner) external initializer {
        require(_owner != address(0), "Zero owner");
        __Pausable_init();
        StorageSlot.getUint256Slot(_RG_STORAGE).value = 1;
        pendingOwner = _owner;
        emit OwnershipTransferStarted(address(0), _owner);
    }

    function initializeV4() external reinitializer(4) {
        StorageSlot.getUint256Slot(_RG_STORAGE).value = 1;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero owner");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // self: 1=adapter, 2=midas, 3=veda. lidoDepositQueues is keyed by (vault,asset)
    // and excluded from this mutex.
    function _requireNoOtherRoute(address vault, uint8 self) internal view {
        if (self != 1) require(vaultAdapters[vault] == address(0), "M01: adapter set");
        if (self != 2) require(midasVaults[vault] == address(0), "M01: midas set");
        if (self != 3) require(vedaTellers[vault] == address(0), "M01: veda set");
    }

    function setVaultWhitelistEnabled(bool _e) external onlyOwner {
        if (vaultWhitelistEnabled == _e) return;
        vaultWhitelistEnabled = _e;
        emit VaultWhitelistToggled(_e);
    }

    function setVaultAllowed(address v, bool a) external onlyOwner {
        if (allowedVaults[v] == a) return;
        allowedVaults[v] = a;
        emit VaultAllowlistUpdated(v, a);
    }

    function setVaultAllowedBatch(address[] calldata v, bool[] calldata a) external onlyOwner {
        require(v.length == a.length, "Length mismatch");
        for (uint256 i = 0; i < v.length; i++) {
            if (allowedVaults[v[i]] == a[i]) continue;
            allowedVaults[v[i]] = a[i];
            emit VaultAllowlistUpdated(v[i], a[i]);
        }
    }

    function setVedaTeller(address vault, address teller) external onlyOwner {
        if (vedaTellers[vault] == teller) return;
        if (teller != address(0)) _requireNoOtherRoute(vault, 3);
        vedaTellers[vault] = teller;
        emit VedaTellerUpdated(vault, teller);
    }

    function setMidasVault(address token, address iv) external onlyOwner {
        if (midasVaults[token] == iv) return;
        if (iv != address(0)) _requireNoOtherRoute(token, 2);
        midasVaults[token] = iv;
        emit MidasVaultUpdated(token, iv);
    }

    function setMidasVaultBatch(address[] calldata t, address[] calldata iv) external onlyOwner {
        require(t.length == iv.length, "Length mismatch");
        for (uint256 i = 0; i < t.length; i++) {
            if (midasVaults[t[i]] == iv[i]) continue;
            if (iv[i] != address(0)) _requireNoOtherRoute(t[i], 2);
            midasVaults[t[i]] = iv[i];
            emit MidasVaultUpdated(t[i], iv[i]);
        }
    }

    function setLidoDepositQueue(address vault, address asset, address queue) external onlyOwner {
        if (lidoDepositQueues[vault][asset] == queue) return;
        lidoDepositQueues[vault][asset] = queue;
        emit LidoDepositQueueUpdated(vault, asset, queue);
    }

    function setLidoDepositQueueBatch(
        address[] calldata vaults, address[] calldata assets, address[] calldata queues
    ) external onlyOwner {
        require(vaults.length == assets.length && assets.length == queues.length, "Length mismatch");
        for (uint256 i = 0; i < vaults.length; i++) {
            if (lidoDepositQueues[vaults[i]][assets[i]] == queues[i]) continue;
            lidoDepositQueues[vaults[i]][assets[i]] = queues[i];
            emit LidoDepositQueueUpdated(vaults[i], assets[i], queues[i]);
        }
    }

    function setVaultAdapter(address vault, address adapter) external onlyOwner {
        if (vaultAdapters[vault] == adapter) return;
        if (adapter != address(0)) _requireNoOtherRoute(vault, 1);
        vaultAdapters[vault] = adapter;
        emit VaultAdapterUpdated(vault, adapter);
    }

    function setVaultAdapterBatch(address[] calldata vaults, address[] calldata adapters) external onlyOwner {
        require(vaults.length == adapters.length, "Length mismatch");
        for (uint256 i = 0; i < vaults.length; i++) {
            if (vaultAdapters[vaults[i]] == adapters[i]) continue;
            if (adapters[i] != address(0)) _requireNoOtherRoute(vaults[i], 1);
            vaultAdapters[vaults[i]] = adapters[i];
            emit VaultAdapterUpdated(vaults[i], adapters[i]);
        }
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (authorizedCallers[caller] == authorized) return;
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerUpdated(caller, authorized);
    }

    function setAuthorizedCallerBatch(address[] calldata callers, bool[] calldata authorized) external onlyOwner {
        require(callers.length == authorized.length, "Length mismatch");
        for (uint256 i = 0; i < callers.length; i++) {
            if (authorizedCallers[callers[i]] == authorized[i]) continue;
            authorizedCallers[callers[i]] = authorized[i];
            emit AuthorizedCallerUpdated(callers[i], authorized[i]);
        }
    }

    function setLidoReferrer(address referrer) external onlyOwner {
        if (lidoReferrer == referrer) return;
        lidoReferrer = referrer;
        emit LidoReferrerUpdated(referrer);
    }

    function setAuthChecksEnabled(bool enabled) external onlyOwner {
        if (authChecksEnabled == enabled) return;
        authChecksEnabled = enabled;
        emit AuthChecksToggled(enabled);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawETH() external onlyOwner {
        uint256 b = address(this).balance;
        require(b > 0, "No ETH");
        (bool ok, ) = owner.call{value: b}("");
        require(ok, "ETH transfer failed");
        emit TokensRescued(address(0), owner, b);
    }

    function rescueERC20(address token, address to, uint256 amt) external onlyOwner {
        require(to != address(0), "Zero recipient");
        IERC20(token).safeTransfer(to, amt);
        emit TokensRescued(token, to, amt);
    }

    // Reject FoT/rebasing assets up-front.
    function _pullExact(address asset, uint256 amount) internal {
        uint256 before = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        require(
            IERC20(asset).balanceOf(address(this)) - before == amount,
            "Unsupported token (FoT/rebase)"
        );
    }

    // Assets are pulled from msg.sender, NOT `user`. Attribution to any `user` is
    // intentional (wallet-SDK model). When authChecksEnabled, msg.sender must be
    // in authorizedCallers.

    function depositFor(
        address vault,
        address asset,
        uint256 amount,
        address user,
        bytes32 partnerId,
        uint8 partnerType,
        bool isERC4626,
        uint256 minSharesOut,
        uint256 deadline
    ) public nonReentrant whenNotPaused whenVaultAllowed(vault) checkDeadline(deadline) onlyAuthorized {
        require(user != address(0) && vault != address(0) && asset != address(0) && amount > 0, "Bad params");
        _pullExact(asset, amount);
        uint256 shares = _executeVaultCall(vault, asset, amount, user, isERC4626);
        require(shares >= minSharesOut, "Slippage");
        emit Routed(partnerId, partnerType, user, vault, asset, amount, shares);
    }

    // V3.1+ shim — 8-arg ABI; deadline = 0.
    function depositFor(
        address vault,
        address asset,
        uint256 amount,
        address user,
        bytes32 partnerId,
        uint8 partnerType,
        bool isERC4626,
        uint256 minSharesOut
    ) public {
        depositFor(vault, asset, amount, user, partnerId, partnerType, isERC4626, minSharesOut, 0);
    }

    // V3.0 shim — 7-arg ABI; minSharesOut = 0, deadline = 0.
    function depositFor(
        address vault,
        address asset,
        uint256 amount,
        address user,
        bytes32 partnerId,
        uint8 partnerType,
        bool isERC4626
    ) external {
        depositFor(vault, asset, amount, user, partnerId, partnerType, isERC4626, 0, 0);
    }

    // Pulls min(allowance, balance) — used by cross-chain composer flows where
    // the caller (e.g. LiFi Executor) holds the post-bridge balance.
    function depositForAvailable(
        address vault,
        address asset,
        address user,
        bytes32 partnerId,
        uint8 partnerType,
        bool isERC4626,
        uint256 minAmount,
        uint256 minSharesOut,
        uint256 deadline
    ) public nonReentrant whenNotPaused whenVaultAllowed(vault) checkDeadline(deadline) onlyAuthorized {
        require(user != address(0) && vault != address(0) && asset != address(0), "Bad params");
        uint256 allowed = IERC20(asset).allowance(msg.sender, address(this));
        uint256 bal = IERC20(asset).balanceOf(msg.sender);
        uint256 amount = allowed < bal ? allowed : bal;
        require(amount >= minAmount && amount > 0, "Insufficient");
        _pullExact(asset, amount);
        uint256 shares = _executeVaultCall(vault, asset, amount, user, isERC4626);
        require(shares >= minSharesOut, "Slippage");
        emit Routed(partnerId, partnerType, user, vault, asset, amount, shares);
    }

    function depositForAvailable(
        address vault,
        address asset,
        address user,
        bytes32 partnerId,
        uint8 partnerType,
        bool isERC4626,
        uint256 minAmount,
        uint256 minSharesOut
    ) external {
        depositForAvailable(vault, asset, user, partnerId, partnerType, isERC4626, minAmount, minSharesOut, 0);
    }

    function depositRequestFor(
        address vault,
        address asset,
        uint256 amount,
        address user,
        bytes32 partnerId,
        uint8 partnerType,
        uint256 deadline
    ) public nonReentrant whenNotPaused whenVaultAllowed(vault) checkDeadline(deadline) onlyAuthorized {
        require(user != address(0) && vault != address(0) && asset != address(0) && amount > 0, "Bad params");
        _pullExact(asset, amount);
        uint256 rid = _executeVaultRequestCall(vault, asset, amount, user);
        emit DepositRequestRouted(partnerId, partnerType, user, vault, asset, amount, rid);
    }

    function depositRequestFor(
        address vault,
        address asset,
        uint256 amount,
        address user,
        bytes32 partnerId,
        uint8 partnerType
    ) external {
        depositRequestFor(vault, asset, amount, user, partnerId, partnerType, 0);
    }

    function _executeVaultCall(
        address vault,
        address asset,
        uint256 amt,
        address recipient,
        bool isERC4626
    ) internal returns (uint256 shares) {
        // Router's asset balance excluding this deposit. Every branch must leave
        // the router holding <= this amount, otherwise deposits stranded dust.
        uint256 routerAssetBaseline = IERC20(asset).balanceOf(address(this)) - amt;

        address adapter = vaultAdapters[vault];
        if (adapter != address(0)) {
            uint256 recipBeforeA = IERC20(vault).balanceOf(recipient);
            uint256 adapterAssetBefore = IERC20(asset).balanceOf(adapter);
            IERC20(asset).safeTransfer(adapter, amt);
            shares = IVaultAdapter(adapter).deposit(vault, asset, amt, recipient);
            require(shares > 0, "Adapter: zero shares");
            uint256 delivered = IERC20(vault).balanceOf(recipient) - recipBeforeA;
            require(delivered >= shares, "Adapter: shares not delivered");
            require(IERC20(asset).balanceOf(adapter) <= adapterAssetBefore, "Adapter retained assets");
            require(IERC20(asset).balanceOf(address(this)) <= routerAssetBaseline, "Asset retained");
            return shares;
        }

        address midasIV = midasVaults[vault];
        if (midasIV != address(0)) {
            uint8 dec = IERC20Metadata(asset).decimals();
            require(dec <= 18, "Midas: decimals > 18");
            // depositInstant takes amountToken in base18.
            uint256 amt18 = dec < 18 ? amt * (10 ** (18 - dec)) : amt;
            IERC20(asset).forceApprove(midasIV, amt);
            uint256 balBefore = IERC20(vault).balanceOf(address(this));
            (bool ok, bytes memory rd) = midasIV.call(
                abi.encodeWithSignature("depositInstant(address,uint256,uint256,bytes32)", asset, amt18, 0, bytes32(0))
            );
            if (!ok) _revertWithReason(rd, "Midas deposit failed");
            shares = IERC20(vault).balanceOf(address(this)) - balBefore;
            require(shares > 0, "Midas: zero shares");
            IERC20(vault).safeTransfer(recipient, shares);
            IERC20(asset).forceApprove(midasIV, 0);
            require(IERC20(asset).balanceOf(address(this)) <= routerAssetBaseline, "Asset retained");
            return shares;
        }

        address teller = vedaTellers[vault];
        if (teller != address(0)) {
            // Veda BoringVault: teller calls vault.enter() with from=msg.sender (router),
            // so approval must be router→vault, not router→teller.
            IERC20(asset).forceApprove(vault, amt);
            uint256 balBefore = IERC20(vault).balanceOf(address(this));
            (bool ok, bytes memory rd) = teller.call(
                abi.encodeWithSignature("deposit(address,uint256,uint256)", asset, amt, 0)
            );
            if (!ok) _revertWithReason(rd, "Veda deposit failed");
            shares = IERC20(vault).balanceOf(address(this)) - balBefore;
            require(shares > 0, "Veda: zero shares");
            IERC20(vault).safeTransfer(recipient, shares);
            IERC20(asset).forceApprove(vault, 0);
            require(IERC20(asset).balanceOf(address(this)) <= routerAssetBaseline, "Asset retained");
            return shares;
        }

        address lidoQueue = lidoDepositQueues[vault][asset];
        if (lidoQueue != address(0)) {
            require(amt <= type(uint224).max, "Lido amt overflow");
            // 2nd arg is a referrer tag, not a recipient. Shares mint to router.
            IERC20(asset).forceApprove(lidoQueue, amt);
            uint256 balBefore = IERC20(vault).balanceOf(address(this));
            bytes32[] memory emptyProof = new bytes32[](0);
            (bool ok, bytes memory rd) = lidoQueue.call(
                abi.encodeWithSignature("deposit(uint224,address,bytes32[])", uint224(amt), lidoReferrer, emptyProof)
            );
            if (!ok) _revertWithReason(rd, "Lido deposit failed");
            shares = IERC20(vault).balanceOf(address(this)) - balBefore;
            require(shares > 0, "Lido report stale, retry");
            IERC20(vault).safeTransfer(recipient, shares);
            IERC20(asset).forceApprove(lidoQueue, 0);
            require(IERC20(asset).balanceOf(address(this)) <= routerAssetBaseline, "Asset retained");
            return shares;
        }

        IERC20(asset).forceApprove(vault, amt);
        if (isERC4626) {
            // Always derive shares from the recipient's on-chain balance delta;
            // never trust the vault-returned count for the slippage decision.
            uint256 recipBefore4626 = IERC20(vault).balanceOf(recipient);
            (bool vok, bytes memory vrd) = vault.call(
                abi.encodeWithSignature("deposit(uint256,address)", amt, recipient)
            );
            if (!vok) _revertWithReason(vrd, "ERC4626 deposit failed");
            uint256 reported = vrd.length >= 32 ? abi.decode(vrd, (uint256)) : 0;
            uint256 delivered = IERC20(vault).balanceOf(recipient) - recipBefore4626;
            require(delivered >= reported, "Vault: shares not delivered");
            shares = delivered;
        } else {
            uint256 recipBefore = IERC20(vault).balanceOf(recipient);
            (bool vok, bytes memory vrd) = vault.call(
                abi.encodeWithSignature("syncDeposit(uint256,address,address)", amt, recipient, address(0))
            );
            if (!vok) _revertWithReason(vrd, "Vault deposit failed");
            shares = IERC20(vault).balanceOf(recipient) - recipBefore;
        }
        require(shares > 0, "Vault: zero shares");
        IERC20(asset).forceApprove(vault, 0);
        require(IERC20(asset).balanceOf(address(this)) <= routerAssetBaseline, "Asset retained");
        return shares;
    }

    function _executeVaultRequestCall(
        address vault,
        address asset,
        uint256 amt,
        address recipient
    ) internal returns (uint256 rid) {
        uint256 routerAssetBaseline = IERC20(asset).balanceOf(address(this)) - amt;
        IERC20(asset).forceApprove(vault, amt);
        (bool ok, bytes memory rd) = vault.call(
            abi.encodeWithSignature("requestDeposit(uint256,address,address)", amt, recipient, address(this))
        );
        if (!ok) _revertWithReason(rd, "requestDeposit failed");
        require(rd.length >= 32, "Bad requestId");
        rid = abi.decode(rd, (uint256));
        IERC20(asset).forceApprove(vault, 0);
        require(IERC20(asset).balanceOf(address(this)) <= routerAssetBaseline, "Asset retained");
    }

    function _revertWithReason(bytes memory rd, string memory fb) internal pure {
        // Error(string) layout: selector[0..3], offset[4..35], length[36..67], data[68..].
        // Length word lives at memory rd+0x44 (rd's 0x20 bytes-length prefix + 0x24 data offset).
        if (rd.length >= 68 && rd[0] == 0x08 && rd[1] == 0xc3 && rd[2] == 0x79 && rd[3] == 0xa0) {
            uint256 len;
            assembly { len := mload(add(rd, 0x44)) }
            if (len > 0 && len <= rd.length - 68) {
                bytes memory err = new bytes(len);
                for (uint256 i = 0; i < len; i++) err[i] = rd[i + 68];
                revert(string(err));
            }
        }
        revert(fb);
    }

    function getImplementation() external view returns (address) {
        return ERC1967Utils.getImplementation();
    }
}
