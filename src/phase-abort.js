'use strict';

function createPhaseAbortController({ label = 'built' } = {}) {
  const controller = new AbortController();
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  let abortedBy = null;

  function abortFromSignal(signalName) {
    if (controller.signal.aborted) return;
    abortedBy = signalName;
    console.error(`\n[${label}] ${signalName} 중단 신호 수신: provider 작업 중단을 요청합니다.`);
    controller.abort(new Error(`${signalName} received`));
  }

  for (const signalName of signals) {
    process.once(signalName, abortFromSignal);
  }

  function cleanup() {
    for (const signalName of signals) {
      process.removeListener(signalName, abortFromSignal);
    }
  }

  return {
    controller,
    signal: controller.signal,
    cleanup,
    get abortedBy() {
      return abortedBy;
    },
  };
}

module.exports = { createPhaseAbortController };
