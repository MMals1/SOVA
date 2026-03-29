from mnemonic import Mnemonic
from config import bytes_for_entropy


def generate_mnemonic(strength_bytes: int = bytes_for_entropy, language: str = "english") -> str:
    """
    Генерирует BIP39 мнемоническую фразу.

    Args:
        strength_bytes: Количество байт энтропии (16 = 12 слов, 32 = 24 слова).
        language: Язык словаря (например, "english").

    Returns:
        Мнемоническая фраза в виде строки.
    """
    mnemo = Mnemonic(language)
    return mnemo.generate(strength=strength_bytes * 8)


if __name__ == "__main__":
    phrase = generate_mnemonic()
    print("Seed фраза:", phrase)
