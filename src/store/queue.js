// Runs tasks one at a time. Button taps, incoming images and the daily timer all read-modify-write
// state.json; serialising them makes "check status, then update" atomic within this process.
function createQueue() {
  let tail = Promise.resolve();
  return {
    run(task) {
      const result = tail.then(task);
      tail = result.catch(() => {});
      return result;
    },
  };
}

module.exports = { createQueue };
