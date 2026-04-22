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
import "./interfaces/IVaultAdapter.sol";

contract DepositRouter is Initializable, ReentrancyGuard, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    string public constant VERSION = "3.1.1";

    // Storage layout — DO NOT reorder or remove; UUPS upgrade compatibility.
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
    uint256[35] private __gap;

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

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier whenVaultAllowed(address vault) {
        if (vaultWhitelistEnabled) require(allowedVaults[vault], "Vault not whitelisted");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initializeV3(address _owner) external initializer {
        require(_owner != address(0), "Zero owner");
        __Pausable_init();
        owner = _owner;
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

    function setVaultWhitelistEnabled(bool _e) external onlyOwner {
        vaultWhitelistEnabled = _e;
        emit VaultWhitelistToggled(_e);
    }
    function setVaultAllowed(address v, bool a) external onlyOwner {
        allowedVaults[v] = a;
        emit VaultAllowlistUpdated(v, a);
    }
    function setVaultAllowedBatch(address[] calldata v, bool[] calldata a) external onlyOwner {
        require(v.length == a.length, "Length mismatch");
        for (uint256 i = 0; i < v.length; i++) {
            allowedVaults[v[i]] = a[i];
            emit VaultAllowlistUpdated(v[i], a[i]);
        }
    }
    function setVedaTeller(address vault, address teller) external onlyOwner {
        vedaTellers[vault] = teller;
        emit VedaTellerUpdated(vault, teller);
    }
    function setMidasVault(address token, address iv) external onlyOwner {
        midasVaults[token] = iv;
        emit MidasVaultUpdated(token, iv);
    }
    function setMidasVaultBatch(address[] calldata t, address[] calldata iv) external onlyOwner {
        require(t.length == iv.length, "Length mismatch");
        for (uint256 i = 0; i < t.length; i++) {
            midasVaults[t[i]] = iv[i];
            emit MidasVaultUpdated(t[i], iv[i]);
        }
    }
    function setLidoDepositQueue(address vault, address asset, address queue) external onlyOwner {
        lidoDepositQueues[vault][asset] = queue;
        emit LidoDepositQueueUpdated(vault, asset, queue);
    }
    function setLidoDepositQueueBatch(
        address[] calldata vaults, address[] calldata assets, address[] calldata queues
    ) external onlyOwner {
        require(vaults.length == assets.length && assets.length == queues.length, "Length mismatch");
        for (uint256 i = 0; i < vaults.length; i++) {
            lidoDepositQueues[vaults[i]][assets[i]] = queues[i];
            emit LidoDepositQueueUpdated(vaults[i], assets[i], queues[i]);
        }
    }
    function setVaultAdapter(address vault, address adapter) external onlyOwner {
        vaultAdapters[vault] = adapter;
        emit VaultAdapterUpdated(vault, adapter);
    }
    function setVaultAdapterBatch(address[] calldata vaults, address[] calldata adapters) external onlyOwner {
        require(vaults.length == adapters.length, "Length mismatch");
        for (uint256 i = 0; i < vaults.length; i++) {
            vaultAdapters[vaults[i]] = adapters[i];
            emit VaultAdapterUpdated(vaults[i], adapters[i]);
        }
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerUpdated(caller, authorized);
    }
    function setAuthorizedCallerBatch(address[] calldata callers, bool[] calldata authorized) external onlyOwner {
        require(callers.length == authorized.length, "Length mismatch");
        for (uint256 i = 0; i < callers.length; i++) {
            authorizedCallers[callers[i]] = authorized[i];
            emit AuthorizedCallerUpdated(callers[i], authorized[i]);
        }
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

    // Assets are pulled from msg.sender, NOT from `user`. A user's approval to this router
    // is never spent when a different address calls with them as `user`. Attribution to any
    // `user` is intentional (wallet-SDK model) — in V3.1.1 the caller check is open so any
    // LiFi bridge receiver can land composer deposits without needing a whitelist update.
    // `authorizedCallers` storage is kept for potential future re-enablement; `setAuthorizedCaller*`
    // and the mapping remain functional but are not consulted here.
    function depositFor(
        address vault,
        address asset,
        uint256 amount,
        address user,
        bytes32 partnerId,
        uint8 partnerType,
        bool isERC4626,
        uint256 minSharesOut
    ) public nonReentrant whenNotPaused whenVaultAllowed(vault) {
        require(user != address(0) && vault != address(0) && asset != address(0) && amount > 0, "Bad params");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        uint256 shares = _executeVaultCall(vault, asset, amount, user, isERC4626);
        require(shares >= minSharesOut, "Slippage");
        emit Routed(partnerId, partnerType, user, vault, asset, amount, shares);
    }

    // V3.0 ABI compatibility shim — forwards to the 8-arg form with no slippage floor.
    // Lets callers keep the pre-upgrade 7-arg ABI through the rollout window.
    function depositFor(
        address vault,
        address asset,
        uint256 amount,
        address user,
        bytes32 partnerId,
        uint8 partnerType,
        bool isERC4626
    ) external {
        depositFor(vault, asset, amount, user, partnerId, partnerType, isERC4626, 0);
    }

    function depositRequestFor(
        address vault,
        address asset,
        uint256 amount,
        address user,
        bytes32 partnerId,
        uint8 partnerType
    ) external nonReentrant whenNotPaused whenVaultAllowed(vault) {
        require(user != address(0) && vault != address(0) && asset != address(0) && amount > 0, "Bad params");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        uint256 rid = _executeVaultRequestCall(vault, asset, amount, user);
        emit DepositRequestRouted(partnerId, partnerType, user, vault, asset, amount, rid);
    }

    function _executeVaultCall(
        address vault,
        address asset,
        uint256 amt,
        address recipient,
        bool isERC4626
    ) internal returns (uint256 shares) {
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
            return shares;
        }

        address midasIV = midasVaults[vault];
        if (midasIV != address(0)) {
            uint8 dec = IERC20Metadata(asset).decimals();
            require(dec <= 18, "Midas: decimals > 18");
            // Midas depositInstant takes amountToken in base18; internal conversion to native
            // decimals matches our `amt` approval.
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
            return shares;
        }

        address lidoQueue = lidoDepositQueues[vault][asset];
        if (lidoQueue != address(0)) {
            require(amt <= type(uint224).max, "Lido amt overflow");
            // Lido SyncDepositQueue: 2nd arg is a referrer tag, not a recipient. Shares mint
            // to msg.sender (router) and we forward below.
            IERC20(asset).forceApprove(lidoQueue, amt);
            uint256 balBefore = IERC20(vault).balanceOf(address(this));
            bytes32[] memory emptyProof = new bytes32[](0);
            (bool ok, bytes memory rd) = lidoQueue.call(
                abi.encodeWithSignature("deposit(uint224,address,bytes32[])", uint224(amt), address(0), emptyProof)
            );
            if (!ok) _revertWithReason(rd, "Lido deposit failed");
            shares = IERC20(vault).balanceOf(address(this)) - balBefore;
            require(shares > 0, "Lido report stale, retry");
            IERC20(vault).safeTransfer(recipient, shares);
            IERC20(asset).forceApprove(lidoQueue, 0);
            return shares;
        }

        IERC20(asset).forceApprove(vault, amt);
        if (isERC4626) {
            (bool vok, bytes memory vrd) = vault.call(
                abi.encodeWithSignature("deposit(uint256,address)", amt, recipient)
            );
            if (!vok) _revertWithReason(vrd, "ERC4626 deposit failed");
            require(vrd.length >= 32, "ERC4626: bad return");
            shares = abi.decode(vrd, (uint256));
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
        return shares;
    }

    function _executeVaultRequestCall(
        address vault,
        address asset,
        uint256 amt,
        address recipient
    ) internal returns (uint256 rid) {
        IERC20(asset).forceApprove(vault, amt);
        (bool ok, bytes memory rd) = vault.call(
            abi.encodeWithSignature("requestDeposit(uint256,address,address)", amt, recipient, address(this))
        );
        if (!ok) _revertWithReason(rd, "requestDeposit failed");
        require(rd.length >= 32, "Bad requestId");
        rid = abi.decode(rd, (uint256));
        IERC20(asset).forceApprove(vault, 0);
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
