/**
 * migrate-mongo configuration.
 *
 * Connection handling: reads MONGODB_URI from the environment (via
 * backend/.env + dotenv, like server.js). Unlike backend/config/database.js
 * — which deliberately requires MONGODB_URI — the CLI falls back to a
 * localhost URI so migrations can run on a dev machine without env setup.
 */
require('dotenv').config();
const path = require('path');

const DEFAULT_URI = 'mongodb://localhost:27017/egyptian_history_rag';
const url = process.env.MONGODB_URI || DEFAULT_URI;

// migrate-mongo wants the database name separately from the URL; derive it
// from the URI path so full connection strings like
// mongodb://host:27017/egyptian_history_rag keep working unchanged.
function databaseNameFromUri(uri) {
  try {
    const name = new URL(uri).pathname.replace(/^\//, '').split('/')[0];
    return name || 'egyptian_history_rag';
  } catch (err) {
    return 'egyptian_history_rag';
  }
}

const config = {
  mongodb: {
    url,
    databaseName: databaseNameFromUri(url),
    options: {}
  },

  // Absolute path so the CLI works regardless of the cwd it is invoked from.
  migrationsDir: path.join(__dirname, 'migrations'),

  // Collection that tracks which migrations have run.
  changelogCollectionName: 'changelog',

  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs'
};

module.exports = config;
