"""
Entry point para PyInstaller.
Lanza el servidor FastAPI con uvicorn directamente desde el ejecutable empaquetado.
"""
import sys
import os
import multiprocessing

# PyInstaller requiere freeze_support() cuando el exe usa multiprocessing.
if getattr(sys, 'frozen', False):
    multiprocessing.freeze_support()


if getattr(sys, 'frozen', False):
    user_data = os.environ.get('SLR_USER_DATA', os.path.dirname(sys.executable))
    os.makedirs(user_data, exist_ok=True)
    os.chdir(user_data)

import uvicorn
from main import app  # noqa: E402 – importar después de ajustar cwd

if __name__ == '__main__':
    uvicorn.run(
        app,
        host='127.0.0.1',
        port=8000,
        log_level='info',
        access_log=False,
    )
