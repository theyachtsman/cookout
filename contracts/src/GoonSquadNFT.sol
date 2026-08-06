// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GoonSquadNFT — the Flame Goon Squad collection, minted on demand
/// @notice Players pull recruits from crates instantly, off-chain, exactly as
///         they do now. This contract is the optional second step: a player who
///         wants the token presses mint and pays their own gas.
///
///         Why on demand rather than pre-minted: the game keeps duplicates, so
///         a card is a TYPE and every mint is a copy. Pre-minting would mean
///         guessing in advance how many copies of each card the crates will
///         ever produce, and being wrong in one direction or the other. Here
///         supply follows play, and the artwork is commissioned once per card
///         rather than once per token — 174 pieces, not thousands.
///
///         What the platform can and cannot do:
///         - It signs a voucher saying "this address pulled this card". Nothing
///           mints without one, so the collection cannot be forged.
///         - It CANNOT mint to itself, move anyone's token, or take one back.
///           There is no owner-mint, no transfer override, no burn-for-others.
///         - Each voucher is single-use, so a signature that leaks cannot be
///           replayed, and it is bound to this chain and this contract, so it
///           cannot be replayed onto another deployment either.
contract GoonSquadNFT {
    string public name = "Flame Goon Squad";
    string public symbol = "FGS";

    /// @notice Signs mint vouchers. Immutable — a rotatable signer is a second
    ///         key that can print the collection, and rotating it would also
    ///         invalidate every voucher already handed out.
    address public immutable signer;
    /// @notice May set the metadata base until it is frozen. Nothing else.
    address public owner;

    /// @notice Metadata root. Tokens of the same card share a URI, because
    ///         they are copies of one artwork, not variations.
    string public baseURI;
    /// @notice Once true, baseURI can never change — the promise that the art
    ///         behind a token cannot be swapped after people own it.
    bool public metadataFrozen;

    uint256 public totalSupply;
    /// @notice Which card each token is a copy of.
    mapping(uint256 => string) public cardOf;
    /// @notice Copies minted per card, so a token can show "#3 of this recruit".
    mapping(string => uint256) public mintedOfCard;
    /// @notice Spent vouchers. A signature works exactly once.
    mapping(bytes32 => bool) public voucherUsed;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Minted(address indexed to, uint256 indexed tokenId, string cardId, uint256 copyNumber);
    event MetadataFrozen(string baseURI);

    error BadSignature();
    error VoucherSpent();
    error NotOwner();
    error Frozen();
    error NotAuthorised();
    error ZeroAddress();
    error NoSuchToken();

    constructor(address signer_, address owner_, string memory baseURI_) {
        if (signer_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        signer = signer_;
        owner = owner_;
        baseURI = baseURI_;
    }

    // ---------------- minting ----------------

    /**
     * @notice Mint a recruit you pulled. The caller pays the gas.
     *
     * @param cardId  The card this token is a copy of.
     * @param nonce   Makes each voucher unique, so one pull mints one token.
     * @param sig     The platform's signature over (chain, contract, you, card, nonce).
     *
     * @dev The voucher is bound to msg.sender: a signature intercepted in
     *      flight is useless to anyone else, because it only mints to the
     *      address it was issued for.
     */
    function mint(string calldata cardId, uint256 nonce, bytes calldata sig) external returns (uint256 tokenId) {
        bytes32 voucher = keccak256(
            abi.encode(block.chainid, address(this), msg.sender, cardId, nonce)
        );
        if (voucherUsed[voucher]) revert VoucherSpent();
        if (_recover(_ethSigned(voucher), sig) != signer) revert BadSignature();
        voucherUsed[voucher] = true;

        tokenId = ++totalSupply;
        cardOf[tokenId] = cardId;
        uint256 copyNumber = ++mintedOfCard[cardId];
        ownerOf[tokenId] = msg.sender;
        balanceOf[msg.sender] += 1;

        emit Transfer(address(0), msg.sender, tokenId);
        emit Minted(msg.sender, tokenId, cardId, copyNumber);
    }

    /// @notice Has this exact voucher been spent? Lets the UI hide a mint
    ///         button that would only revert.
    function voucherSpent(address to, string calldata cardId, uint256 nonce) external view returns (bool) {
        return voucherUsed[keccak256(abi.encode(block.chainid, address(this), to, cardId, nonce))];
    }

    // ---------------- metadata ----------------

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (ownerOf[tokenId] == address(0)) revert NoSuchToken();
        // Per card, not per token: every copy of a recruit is the same artwork.
        return string.concat(baseURI, cardOf[tokenId]);
    }

    /// @notice Point the collection at its artwork. Only until it is frozen.
    function setBaseURI(string calldata next) external {
        if (msg.sender != owner) revert NotOwner();
        if (metadataFrozen) revert Frozen();
        baseURI = next;
    }

    /// @notice Give up the ability to change the art, permanently. One way.
    function freezeMetadata() external {
        if (msg.sender != owner) revert NotOwner();
        metadataFrozen = true;
        emit MetadataFrozen(baseURI);
    }

    function transferOwnership(address next) external {
        if (msg.sender != owner) revert NotOwner();
        if (next == address(0)) revert ZeroAddress();
        owner = next;
    }

    // ---------------- ERC-721 ----------------

    function approve(address to, uint256 tokenId) external {
        address holder = ownerOf[tokenId];
        if (msg.sender != holder && !isApprovedForAll[holder][msg.sender]) revert NotAuthorised();
        getApproved[tokenId] = to;
        emit Approval(holder, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (ownerOf[tokenId] != from) revert NotAuthorised();
        if (to == address(0)) revert ZeroAddress();
        if (
            msg.sender != from &&
            msg.sender != getApproved[tokenId] &&
            !isApprovedForAll[from][msg.sender]
        ) revert NotAuthorised();
        delete getApproved[tokenId];
        ownerOf[tokenId] = to;
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length > 0) {
            bytes4 ret = IERC721ReceiverLike(to).onERC721Received(msg.sender, from, tokenId, data);
            if (ret != IERC721ReceiverLike.onERC721Received.selector) revert NotAuthorised();
        }
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f; // ERC165, 721, metadata
    }

    // ---------------- signature plumbing ----------------

    function _ethSigned(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        // Reject the high-s half of the curve: every signature has a second
        // valid form, and accepting both would let one voucher be presented
        // twice with different bytes.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0)
            revert BadSignature();
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert BadSignature();
        return recovered;
    }
}

interface IERC721ReceiverLike {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}
