// SERVER comes from the runner's -e. A flow must not set it itself (its own
// env wins over -e and would send every slot to the same server), so a run
// without -e says so here instead of typing "undefined" into the app.
if (typeof SERVER === 'undefined' || !SERVER) {
  throw new Error('SERVER is not set: pass -e SERVER=http://10.0.2.2:3200 (ops/maestro.sh does)');
}
