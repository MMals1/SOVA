from eth_hash.auto import keccak


def generate_eth_address(public_key: bytes) -> str:
    """
    Генерирует Ethereum-адрес из публичного ключа (EIP-55 checksum).

    Args:
        public_key: Несжатый публичный ключ без префикса 0x04 (64 байта).

    Returns:
        Ethereum-адрес в формате 0x... с EIP-55 checksum.
    """
    address_bytes = keccak(public_key)[-20:]
    address_hex = address_bytes.hex()
    return _to_checksum_address(address_hex)


def _to_checksum_address(address_hex: str) -> str:
    """Применяет EIP-55 checksum (смешанный регистр) к hex-адресу."""
    checksum_hash = keccak(address_hex.encode()).hex()
    return "0x" + "".join(
        c.upper() if int(checksum_hash[i], 16) >= 8 else c
        for i, c in enumerate(address_hex)
    )
