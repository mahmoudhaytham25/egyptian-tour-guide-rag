const path = require('path');

// Shared filesystem contract with the model server: uploaded PDFs land in
// data/, index artifacts (<base>_vectors.npz + <base>_metadata.json) in
// vector_store/. In compose both are named volumes mounted under
// ../model-server relative to the backend root; MODEL_SERVER_DATA_DIR
// overrides the data dir for other layouts (vector_store stays its sibling).
const DATA_DIR = process.env.MODEL_SERVER_DATA_DIR ||
  path.join(__dirname, '../../model-server/data');
const VECTOR_STORE_DIR = path.join(path.dirname(DATA_DIR), 'vector_store');

module.exports = { DATA_DIR, VECTOR_STORE_DIR };
