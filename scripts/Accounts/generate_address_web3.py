from eth_account import Account
from eth_account.hdaccount import generate_mnemonic as _generate_mnemonic
from config import bytes_for_entropy, DERIVATION_PATH


def generate_mnemonic(strength_bytes: int = bytes_for_entropy) -> str:
    """
    Генерирует BIP39 мнемоническую фразу через eth_account.

    Args:
        strength_bytes: Количество байт энтропии (16 = 12 слов, 32 = 24 слова).

    Returns:
        Мнемоническая фраза в виде строки.
    """
    return _generate_mnemonic(strength_bytes * 8, "english")


def generate_private_key(phrase: str, path: str = "m/44'/60'/0'/0/0") -> bytes:
    """
    Деривирует приватный ключ из мнемонической фразы по пути деривации.

    Args:
        phrase: Мнемоническая фраза.
        path: Путь деривации BIP44 в виде строки.

    Returns:
        Приватный ключ в виде 32 байт.
    """
    Account.enable_unaudited_hdwallet_features()
    account = Account.from_mnemonic(phrase, account_path=path)
    return bytes(account.key)


def generate_eth_address(private_key: bytes) -> str:
    """
    Генерирует Ethereum-адрес из приватного ключа (EIP-55 checksum).

    Args:
        private_key: Приватный ключ в виде 32 байт.

    Returns:
        Ethereum-адрес в формате 0x... с EIP-55 checksum.
    """
    return Account.from_key(private_key).address
