from coincurve import PublicKey


def generate_public_key(private_key: bytes) -> bytes:
    """
    Генерирует несжатый публичный ключ из приватного (без префикса 0x04).

    Args:
        private_key: Приватный ключ в виде 32 байт.

    Returns:
        Публичный ключ в виде 64 байт (x + y координаты).
    """
    uncompressed = PublicKey.from_valid_secret(private_key).format(compressed=False)
    return uncompressed[1:]  # убираем префикс 0x04
