#!/usr/bin/env python3
"""Exporta el conectoma FlyWire (cerebro adulto de Drosophila) a binarios web.
Salidas: neurons.bin, synapses.bin (CSR), tables.json"""
from scipy.io import loadmat
import numpy as np
import json, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'data')
os.makedirs(OUT, exist_ok=True)

print("cargando .mat ...")
coord = loadmat('coordinates.mat')['coor']                      # (138639,3) float64 um
ann_m = loadmat('annotations.mat')
names, labels = ann_m['names'], ann_m['labels']
W_m = loadmat('connectome.mat')
W = W_m['W']

N = coord.shape[0]
NTS = ['ACH', 'DA', 'GABA', 'GLUT', 'OCT', 'SER']

def flat_str_list(field):
    arr = names[field].flat[0]
    out = []
    for x in arr:
        s = str(np.squeeze(x)).strip()
        if s.startswith('[') and s.endswith(']'):
            s = s[1:-1].strip().strip("'\"")
        out.append(s)
    return out

def idx_to_labels(field, n_out):
    """labels[field] tiene índices 1-based -> array 0-based (0 = sin dato)."""
    arr = labels[field].flat[0].ravel().astype(np.int32)
    return (arr - 1).clip(-1) + 1  # conservamos 1-based, 0 = sin dato

# --- tablas de categorías ---
tables = {
    'super_class': flat_str_list('super_class'),
    'class': flat_str_list('class'),
    'sub_class': flat_str_list('sub_class'),
    'cell_type': flat_str_list('cell_type'),
    'flow': flat_str_list('flow'),
    'hemilineage': flat_str_list('hemilineage'),
    'nerve': flat_str_list('nerve'),
    'nt': NTS,
}

# --- neurotransmisor dominante por neurona (fila de cada matriz NT) ---
print("computando neurotransmisor dominante ...")
nt_dom = np.zeros(N, dtype=np.int8)  # 0 = desconocido
rowsums = np.zeros((N, len(NTS)), dtype=np.float32)
for j, nt in enumerate(NTS):
    M = W[nt].flat[0]
    rowsums[:, j] = np.asarray(M.sum(axis=1)).ravel()
best = rowsums.argmax(axis=1)
has = rowsums.max(axis=1) > 0
nt_dom[has] = best[has] + 1

# --- lado (left/right) desde hemibrain/side: usamos coordenada x ---
# coordenadas: x crece hacia un lado; determinamos por mediana
xs = coord[:, 0]
side = (xs > np.median(xs)).astype(np.int8)  # 0/1

# --- neuronas.bin: x,y,z float32 | super_class u8 | flow u8 | nt u8 | side u8 | cell_type u16 ---
sc = idx_to_labels('super_class', N).astype(np.uint8)
fl = idx_to_labels('flow', N).astype(np.uint8)
ct = idx_to_labels('cell_type', N).astype(np.uint16)
cl = idx_to_labels('class', N).astype(np.uint8)
sb = idx_to_labels('sub_class', N).astype(np.uint8)
neurons = np.zeros(N, dtype=np.dtype([
    ('x', '<f4'), ('y', '<f4'), ('z', '<f4'),
    ('super_class', 'u1'), ('flow', 'u1'), ('nt', 'u1'), ('side', 'u1'),
    ('cell_type', '<u2'), ('class', 'u1'), ('sub_class', 'u1'),
]))
neurons['x'] = coord[:, 0].astype(np.float32)
neurons['y'] = coord[:, 1].astype(np.float32)
neurons['z'] = coord[:, 2].astype(np.float32)
neurons['super_class'] = sc
neurons['flow'] = fl
neurons['nt'] = nt_dom.astype(np.uint8)
neurons['side'] = side
neurons['cell_type'] = ct
neurons['class'] = cl
neurons['sub_class'] = sb
neurons.tofile(os.path.join(OUT, 'neurons.bin'))
print("neurons.bin:", os.path.getsize(os.path.join(OUT, 'neurons.bin')) // 1024, "KB")

# --- sinapsis.bin: CSR de TOT ---
print("exportando CSR de TOT ...")
TOT = W['TOT'].flat[0].tocsr()
rowptr = TOT.indptr.astype(np.uint32)
targets = TOT.indices.astype(np.uint32)
weights = np.clip(TOT.data, 0, 65535).astype(np.uint16)
with open(os.path.join(OUT, 'synapses.bin'), 'wb') as f:
    f.write(np.uint32(N).tobytes())
    rowptr.tofile(f); targets.tofile(f); weights.tofile(f)
print("synapses.bin:", os.path.getsize(os.path.join(OUT, 'synapses.bin')) // (1024*1024), "MB")

tables['n_neurons'] = int(N)
tables['n_synapses'] = int(TOT.nnz)
tables['max_weight'] = float(TOT.data.max())
with open(os.path.join(OUT, 'tables.json'), 'w') as f:
    json.dump(tables, f)
print("listo.")
