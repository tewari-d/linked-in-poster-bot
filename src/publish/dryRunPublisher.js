// Used while DRY_RUN is on: does everything except the LinkedIn call.
function createDryRunPublisher({ api }) {
  async function publish({ draft }) {
    // Downloading the image proves the Telegram file path works before LinkedIn is wired in.
    const imageBytes = draft.image ? (await api.downloadFile(draft.image.fileId)).length : 0;
    return { dryRun: true, url: null, imageBytes };
  }
  return { name: 'dry-run', publish };
}

module.exports = { createDryRunPublisher };
