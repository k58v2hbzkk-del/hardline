// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// TapeOut circuits contract (X Layer). eval returns the chip's output bytes.
interface ITapeOutCircuits {
    function eval(uint256 id, bytes calldata input) external view returns (bytes memory);
}

/// @title HardlineVault
/// @notice Holds OKB and releases it only when a Hardline chip (a TapeOut circuit) answers ALLOW.
///         The vault never decides on its own: it builds the facts from onchain state and asks the chip.
///         Facts layout (matches Hardline chip #2, treasury 3-of-5):
///           bit 0..4 = signer slot 1..5 approved this payment
///           bit 5    = vault is frozen
///         There is no owner, no upgrade and no admin withdrawal. Unaudited demo.
contract HardlineVault {
    ITapeOutCircuits public immutable circuits;
    uint256 public immutable chipId;
    address public immutable guardian;   // may freeze / unfreeze
    address[5] public signers;            // slot owners (one wallet may hold several slots in a demo)

    bool public frozen;

    struct Payment {
        address payable to;
        uint256 amount;
        uint8 approvals;   // bitmask of approved slots
        bool done;
    }
    Payment[] public payments;

    event Deposited(address indexed from, uint256 amount);
    event Proposed(uint256 indexed id, address indexed to, uint256 amount);
    event Approved(uint256 indexed id, uint8 slot);
    event FrozenSet(bool frozen);
    event Released(uint256 indexed id, address indexed to, uint256 amount, bytes1 facts);
    event Blocked(uint256 indexed id, bytes1 facts, bytes answer);

    constructor(address circuits_, uint256 chipId_, address guardian_, address[5] memory signers_) {
        circuits = ITapeOutCircuits(circuits_);
        chipId = chipId_;
        guardian = guardian_;
        signers = signers_;
    }

    receive() external payable { emit Deposited(msg.sender, msg.value); }

    function deposit() external payable { emit Deposited(msg.sender, msg.value); }

    function paymentsCount() external view returns (uint256) { return payments.length; }

    function isSigner(address a) public view returns (bool) {
        for (uint8 i = 0; i < 5; i++) if (signers[i] == a) return true;
        return false;
    }

    function propose(address payable to, uint256 amount) external returns (uint256 id) {
        require(isSigner(msg.sender), "not a signer");
        require(to != address(0) && amount > 0, "bad payment");
        payments.push(Payment(to, amount, 0, false));
        id = payments.length - 1;
        emit Proposed(id, to, amount);
    }

    /// @param slot 0..4 — caller must own that signer slot
    function approve(uint256 id, uint8 slot) external {
        require(slot < 5 && signers[slot] == msg.sender, "not your slot");
        Payment storage p = payments[id];
        require(!p.done, "done");
        p.approvals |= uint8(1 << slot);
        emit Approved(id, slot);
    }

    function setFrozen(bool f) external {
        require(msg.sender == guardian, "not guardian");
        frozen = f;
        emit FrozenSet(f);
    }

    /// The facts byte the chip will see for this payment right now.
    function factsFor(uint256 id) public view returns (bytes1) {
        uint8 b = payments[id].approvals & 0x1f;
        if (frozen) b |= 0x20;
        return bytes1(b);
    }

    /// Ask the chip without spending anything.
    function check(uint256 id) public view returns (bool allowed, bytes1 facts) {
        facts = factsFor(id);
        bytes memory out = circuits.eval(chipId, abi.encodePacked(facts));
        allowed = out.length > 0 && (uint8(out[0]) & 1) == 1;
    }

    /// Pays out only if the chip answers ALLOW. A DENY is recorded onchain (Blocked) and nothing moves.
    function execute(uint256 id) external returns (bool released) {
        require(isSigner(msg.sender), "not a signer");
        Payment storage p = payments[id];
        require(!p.done, "done");
        bytes1 facts = factsFor(id);
        bytes memory out = circuits.eval(chipId, abi.encodePacked(facts));
        if (out.length == 0 || (uint8(out[0]) & 1) == 0) {
            emit Blocked(id, facts, out);
            return false;
        }
        require(address(this).balance >= p.amount, "vault balance too low");
        p.done = true;
        (bool ok, ) = p.to.call{value: p.amount}("");
        require(ok, "transfer failed");
        emit Released(id, p.to, p.amount, facts);
        return true;
    }
}

/// Test double: simulates a TapeOut netlist exactly like the processor (wire0=0, wire1=1, inputs, NAND cells, last nOut outputs).
contract MockCircuits {
    bytes public nl; uint256 public nIn;
    constructor(bytes memory nl_, uint256 nIn_) { nl = nl_; nIn = nIn_; }
    function eval(uint256, bytes calldata input) external view returns (bytes memory) {
        uint256 cells = nl.length / 7;
        uint8[] memory w = new uint8[](2 + nIn + cells);
        w[1] = 1;
        for (uint256 i = 0; i < nIn; i++) w[2 + i] = (uint8(input[i >> 3]) >> (i & 7)) & 1;
        for (uint256 k = 0; k < cells; k++) {
            uint256 o = k * 7;
            uint256 a = (uint256(uint8(nl[o+1])) << 16) | (uint256(uint8(nl[o+2])) << 8) | uint256(uint8(nl[o+3]));
            uint256 b = (uint256(uint8(nl[o+4])) << 16) | (uint256(uint8(nl[o+5])) << 8) | uint256(uint8(nl[o+6]));
            w[2 + nIn + k] = 1 - (w[a] & w[b]);
        }
        bytes memory out = new bytes(1);
        out[0] = bytes1(w[w.length - 1]);
        return out;
    }
}
