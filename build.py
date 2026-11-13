# Builds index.html from src/ (single self-contained page for GitHub Pages / OKX Wallet browser).
from pathlib import Path
s = Path(__file__).parent / "src"
ui = (s / "ui.html").read_text()
for tag, f in [("/*COMPILER*/", "compiler.js"), ("/*CHAIN*/", "chain.js"), ("/*MINT*/", "mint.js"), ("/*VAULTBC*/", "vault-bytecode.js"), ("/*VAULT*/", "vault.js")]:
    ui = ui.replace(tag, (s / f).read_text())
(Path(__file__).parent / "index.html").write_text(ui)
print("index.html built")
