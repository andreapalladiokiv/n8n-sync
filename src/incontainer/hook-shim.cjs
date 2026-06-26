'use strict';
// n8n EXTERNAL HOOK entrypoint (EXTERNAL_HOOK_FILES → this file). Plain CJS, copied verbatim to
// dist/hook.cjs. n8n `require()`s this and iterates the export's own keys, so the export must be
// exactly `{ workflow: { afterCreate:[…], afterUpdate:[…], afterDelete:[…] } }` with no __esModule
// wrapper — hence this shim over the esbuild bundle (dist/hook-impl.cjs), which carries the logic.
const impl = require('./hook-impl.cjs');
module.exports = {
  workflow: {
    afterCreate: [impl.onCreate],
    afterUpdate: [impl.onUpdate],
    afterDelete: [impl.onDelete],
  },
};
