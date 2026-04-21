// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

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

    string public constant VERSION = "3.0.0";

    // V1 storage — slots preserved for UUPS layout compatibility (DO NOT reorder or remove)
    mapping(address => uint256) private _deprecated_nonces;
    mapping(bytes32 => bytes32) private _deprecated_deposits; // was DepositRecord mapping
    mapping(address => mapping(address => uint256)) private _deprecated_referralEarnings;
    address private _deprecated_feeCollector;
    address public owner;
    address private _deprecated_oracle;
    mapping(address => bytes32) private _deprecated_priceFeedIds;
    uint256 private _deprecated_maxSlippageBps;
    uint256 private _deprecated_minDepositUsd;
    // V2 storage — deprecated slots
    uint256 private _deprecated_feeBps;
    mapping(address => bool) public allowedVaults;
    bool public vaultWhitelistEnabled;
    address public pendingOwner;
    mapping(address => address) public vedaTellers;
    address private _deprecated_signer;
    mapping(address => address) public midasVaults;
    uint16 private _deprecated_referralSplitBps;
    // V2.6 storage — deprecated
    mapping(address => address) private _deprecated_midasRedemptionVaults;
    mapping(bytes32 => bytes32) private _deprecated_withdrawRequests; // was WithdrawRequest mapping
    address private _deprecated_withdrawEscrowImpl;
    // V2.6.2
    mapping(address => mapping(address => address)) public lidoDepositQueues;
    // V2.7
    mapping(address => address) public vaultAdapters;
    uint256[36] private __gap;

    event Routed(bytes32 indexed partnerId, uint8 partnerType, address indexed user, address indexed vault, address asset, uint256 amount);
    event DepositRequestRouted(bytes32 indexed partnerId, uint8 partnerType, address indexed user, address indexed vault, address asset, uint256 amount, uint256 requestId);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event VaultWhitelistToggled(bool enabled);
    event VaultAllowlistUpdated(address indexed vault, bool allowed);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);
    event VedaTellerUpdated(address indexed vault, address indexed teller);
    event MidasVaultUpdated(address indexed token, address indexed issuanceVault);
    event LidoDepositQueueUpdated(address indexed vault, address indexed asset, address indexed queue);
    event VaultAdapterUpdated(address indexed vault, address indexed adapter);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier whenVaultAllowed(address vault) { if (vaultWhitelistEnabled) require(allowedVaults[vault], "Vault not whitelisted"); _; }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function reinitializeV5() external reinitializer(5) {}

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Admin: ownership ──

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

    // ── Admin: configuration ──

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
    function setLidoDepositQueue(address vault, address asset, address queue) external onlyOwner {
        lidoDepositQueues[vault][asset] = queue;
        emit LidoDepositQueueUpdated(vault, asset, queue);
    }
    function setLidoDepositQueueBatch(address[] calldata vaults, address[] calldata assets, address[] calldata queues) external onlyOwner {
        require(vaults.length == assets.length && assets.length == queues.length);
        for (uint256 i = 0; i < vaults.length; i++) {
            lidoDepositQueues[vaults[i]][assets[i]] = queues[i];
            emit LidoDepositQueueUpdated(vaults[i], assets[i], queues[i]);
        }
    }
    function setVaultAdapter(address vault, address adapter) external onlyOwner { vaultAdapters[vault] = adapter; emit VaultAdapterUpdated(vault, adapter); }
    function setVaultAdapterBatch(address[] calldata vaults, address[] calldata adapters) external onlyOwner {
        require(vaults.length == adapters.length);
        for (uint256 i = 0; i < vaults.length; i++) { vaultAdapters[vaults[i]] = adapters[i]; emit VaultAdapterUpdated(vaults[i], adapters[i]); }
    }
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

    // ── Public: deposit (same-chain + two-step cross-chain step-2) ──

    function depositFor(
        address vault, address asset, uint256 amount, address user,
        bytes32 partnerId, uint8 partnerType, bool isERC4626
    ) external nonReentrant whenNotPaused whenVaultAllowed(vault) {
        require(user != address(0) && vault != address(0) && amount > 0);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        _executeVaultCall(vault, asset, amount, user, isERC4626);
        emit Routed(partnerId, partnerType, user, vault, asset, amount);
    }

    function depositRequestFor(
        address vault, address asset, uint256 amount, address user,
        bytes32 partnerId, uint8 partnerType
    ) external nonReentrant whenNotPaused whenVaultAllowed(vault) {
        require(user != address(0) && vault != address(0) && amount > 0);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        uint256 rid = _executeVaultRequestCall(vault, asset, amount, user);
        emit DepositRequestRouted(partnerId, partnerType, user, vault, asset, amount, rid);
    }

    // ── Internal: vault dispatch (UNCHANGED from V2.7) ──

    function _executeVaultCall(address vault, address asset, uint256 amt, address recipient, bool isERC4626) internal {
        address adapter = vaultAdapters[vault];
        if (adapter != address(0)) {
            IERC20(asset).safeTransfer(adapter, amt);
            uint256 shares = IVaultAdapter(adapter).deposit(vault, asset, amt, recipient);
            require(shares > 0, "Adapter returned 0 shares");
            return;
        }
        address midasIV = midasVaults[vault];
        if (midasIV != address(0)) {
            IERC20(asset).forceApprove(midasIV, amt);
            uint256 balBefore = IERC20(vault).balanceOf(address(this));
            uint8 dec = IERC20Metadata(asset).decimals();
            uint256 amt18 = dec < 18 ? amt * (10 ** (18 - dec)) : (dec > 18 ? amt / (10 ** (dec - 18)) : amt);
            (bool ok, bytes memory rd) = midasIV.call(abi.encodeWithSignature("depositInstant(address,uint256,uint256,bytes32)", asset, amt18, 0, bytes32(0)));
            if (!ok) _revertWithReason(rd, "Midas deposit failed");
            uint256 received = IERC20(vault).balanceOf(address(this)) - balBefore;
            if (received > 0) IERC20(vault).safeTransfer(recipient, received);
            IERC20(asset).forceApprove(midasIV, 0);
            return;
        }
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
        address lidoQueue = lidoDepositQueues[vault][asset];
        if (lidoQueue != address(0)) {
            require(amt <= type(uint224).max, "Lido amt overflow");
            IERC20(asset).forceApprove(lidoQueue, amt);
            uint256 balBefore = IERC20(vault).balanceOf(address(this));
            bytes32[] memory emptyProof = new bytes32[](0);
            (bool ok, bytes memory rd) = lidoQueue.call(
                abi.encodeWithSignature("deposit(uint224,address,bytes32[])", uint224(amt), address(0), emptyProof)
            );
            IERC20(asset).forceApprove(lidoQueue, 0);
            if (!ok) _revertWithReason(rd, "Lido deposit failed");
            uint256 received = IERC20(vault).balanceOf(address(this)) - balBefore;
            require(received > 0, "Lido report stale, retry");
            IERC20(vault).safeTransfer(recipient, received);
            return;
        }
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

    // ── View ──

    function getImplementation() external view returns (address) { return ERC1967Utils.getImplementation(); }

    receive() external payable {}
}
