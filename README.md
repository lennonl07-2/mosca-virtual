# Mosca virtual

Visualización 3D interactiva de una mosca de la fruta y una simulación simplificada basada en su conectoma. La interfaz y el motor se ejecutan en el navegador; el procesamiento neuronal usa un Web Worker.

## Probar

La demo del portafolio está publicada en https://lennon-linares-portfolio.pages.dev/demos/mosca/. El repositorio contiene el código fuente, pero no incluye los binarios derivados del conectoma.

Para preparar una copia local, consigue los archivos fuente del conjunto de datos FlyWire citado abajo, revisa sus condiciones de uso y coloca `coordinates.mat`, `annotations.mat` y `connectome.mat` junto a `data/export.py`. Instala Python con NumPy y SciPy, ejecuta `python data/export.py` desde esa carpeta y sirve `web/` por HTTP. El navegador requiere soporte para WebGL, Workers y `DecompressionStream`.

## Datos y créditos

Los datos derivados de FlyWire se describen en [Zenodo, DOI 10.5281/zenodo.18555170](https://doi.org/10.5281/zenodo.18555170) y en [Codex FlyWire](https://codex.flywire.ai/). Ese registro no muestra un valor de licencia en sus metadatos; por eso este repositorio publica el código y no redistribuye los archivos de datos.

La visualización utiliza Three.js, distribuido bajo MIT; conserva el aviso incluido en `web/js/three.module.min.js`. La simulación LIF es educativa y simplificada: no representa el comportamiento de una mosca viva.
