// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract WithdrawalEscrow {
    using SafeERC20 for IERC20;

    address public router;

    modifier onlyRouter() { require(msg.sender == router, "Not router"); _; }

    function init(address _router) external {
        require(router == address(0));
        router = _router;
    }

    function submitMidasRequest(address share, address midasRV, address tokenOut, uint256 amt) external onlyRouter returns (uint256 reqId) {
        IERC20(share).forceApprove(midasRV, amt);
        (bool ok, bytes memory rd) = midasRV.call(abi.encodeWithSignature("redeemRequest(address,uint256)", tokenOut, amt));
        require(ok, _reason(rd));
        reqId = abi.decode(rd, (uint256));
    }

    function sweep(address asset, address to) external onlyRouter returns (uint256 amt) {
        amt = IERC20(asset).balanceOf(address(this));
        if (amt > 0) IERC20(asset).safeTransfer(to, amt);
    }

    function _reason(bytes memory rd) internal pure returns (string memory) {
        if (rd.length < 68) return "Escrow call failed";
        assembly { rd := add(rd, 0x04) }
        return abi.decode(rd, (string));
    }
}
