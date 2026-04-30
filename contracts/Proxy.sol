// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Yieldo's UUPS proxy. Atomic-init is enforced (audit L-02): the
/// implementation's `initializeV3(...)` must be encoded into `data` at
/// construction time so a freshly-deployed proxy is never temporarily
/// uninitialized — preventing front-run hijacks of `initializeV3`.
contract YieldoProxy is ERC1967Proxy {
    constructor(address impl, bytes memory data) ERC1967Proxy(impl, data) {
        require(data.length > 0, "Init data required");
    }
}
