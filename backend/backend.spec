

import os
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

# ──────────────────────────────────────────────
# psycopg2-binary: recoger DLLs de la carpeta del paquete
# (libpq.dll, libcrypto-*.dll, libssl-*.dll, etc.)
# ──────────────────────────────────────────────
try:
    import psycopg2 as _pg2
    _pg2_dir = os.path.dirname(_pg2.__file__)
    _pg2_dlls = [
        (os.path.join(_pg2_dir, f), 'psycopg2')
        for f in os.listdir(_pg2_dir)
        if f.lower().endswith('.dll')
    ]
except Exception:
    _pg2_dlls = []

# ──────────────────────────────────────────────
# Hidden imports
# ──────────────────────────────────────────────
hidden = []

# Web framework / server
hidden += collect_submodules('uvicorn')
hidden += collect_submodules('fastapi')
hidden += collect_submodules('starlette')
hidden += collect_submodules('anyio')
hidden += collect_submodules('h11')
hidden += collect_submodules('httptools')
hidden += collect_submodules('watchfiles')

# Data validation
hidden += collect_submodules('pydantic')
hidden += collect_submodules('pydantic_core')

# Database
hidden += collect_submodules('sqlalchemy')
hidden += collect_submodules('alembic')
hidden += ['psycopg2', 'psycopg2.extensions', 'psycopg2.extras']

# File upload
hidden += collect_submodules('multipart')

# LLM clients
hidden += collect_submodules('anthropic')
hidden += collect_submodules('openai')
hidden += collect_submodules('google.generativeai')
hidden += collect_submodules('google.ai.generativelanguage_v1beta')
hidden += collect_submodules('grpc')

# Tokenisation
hidden += ['tiktoken', 'tiktoken.core', 'tiktoken_ext', 'tiktoken_ext.openai_public']

# PDF
hidden += ['fitz', 'pymupdf']

# HTML → Markdown
hidden += collect_submodules('trafilatura')
hidden += collect_submodules('lxml')
hidden += collect_submodules('charset_normalizer')

# Misc
hidden += ['bibtexparser', 'requests', 'dotenv', 'python_dotenv']

# Export / fuzzy
hidden += collect_submodules('pandas')
hidden += collect_submodules('openpyxl')
hidden += ['rapidfuzz', 'rapidfuzz.distance']

# HTTP (usado por anthropic / openai internamente)
hidden += collect_submodules('httpx')
hidden += collect_submodules('httpcore')

# Routers (evitar que PyInstaller los omita al no ser importados estáticamente)
hidden += [
    'routers', 'routers.imports', 'routers.searches', 'routers.pdfs',
    'routers.references', 'routers.dedup', 'routers.screening',
    'routers.custom_fields', 'routers.costs', 'routers.qa',
    'routers.stats', 'routers.changelog', 'routers.annotations',
]

# Services
hidden += [
    'services', 'services.assisted_import', 'services.bib_parser',
    'services.cost_tracker', 'services.dedup_engine', 'services.html_to_markdown',
    'services.llm_client', 'services.oa_downloader', 'services.pdf_handler',
    'services.pdf_text_extractor', 'services.qa_engine',
]

# Models
hidden += [
    'models', 'models.annotation', 'models.change_log', 'models.custom_field',
    'models.duplicate', 'models.field_value', 'models.paper_text',
    'models.prisma_data', 'models.qa_response', 'models.reference',
    'models.screening', 'models.search_reference', 'models.search_term',
    'models.search', 'models.term_match', 'models.token_usage',
]

# ──────────────────────────────────────────────
# Data files
# ──────────────────────────────────────────────
datas = [
    ('data/models.json', 'data'),
]
datas += collect_data_files('tiktoken')
datas += collect_data_files('tiktoken_ext')
datas += collect_data_files('trafilatura')
datas += collect_data_files('certifi')

# ──────────────────────────────────────────────
# Análisis
# ──────────────────────────────────────────────
a = Analysis(
    ['server.py'],
    pathex=['.'],
    binaries=_pg2_dlls,
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'numpy', 'scipy', 'PIL', 'cv2'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,       # consola visible para logging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='backend',     # → dist/backend/
)
