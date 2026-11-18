const { buildCommentary, MAX_COMMENTARY } = require('../linkedin/littleText');
const { postUrl } = require('../linkedin/linkedinApi');

// The create-post call may have succeeded even though no answer came back, so the draft must not
// simply return to "waiting": the owner checks LinkedIn first.
class UncertainPublishError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'UncertainPublishError';
    this.uncertain = true;
  }
}

const reconnectHint = (err) => (err.status === 401 ? `${err.message}. LinkedIn no longer accepts the saved access: send /linkedin to reconnect.` : err.message);

function createLinkedInPublisher({ linkedinApi, telegramApi, auth, disclaimer = '' }) {
  async function publish({ draft }) {
    const commentary = buildCommentary({ text: draft.text, disclaimer, hashtags: draft.hashtags });
    if (commentary.length > MAX_COMMENTARY) {
      throw new Error(`The post is ${commentary.length} characters in LinkedIn's format (max ${MAX_COMMENTARY}). Tap 🔄 Regenerate for a shorter version.`);
    }
    const { accessToken, memberUrn } = auth.requireToken();

    // Everything before the create-post call fails cleanly: nothing is on LinkedIn yet.
    let imageUrn = null;
    let imageBytes = 0;
    if (draft.image) {
      const bytes = await telegramApi.downloadFile(draft.image.fileId);
      imageBytes = bytes.length;
      try {
        imageUrn = await linkedinApi.uploadImage({ accessToken, owner: memberUrn, bytes });
      } catch (err) {
        throw new Error(reconnectHint(err), { cause: err });
      }
    }

    let postUrn;
    try {
      postUrn = await linkedinApi.createPost({ accessToken, author: memberUrn, commentary, imageUrn });
    } catch (err) {
      if (err.ambiguous) throw new UncertainPublishError(err.message, { cause: err });
      throw new Error(reconnectHint(err), { cause: err });
    }
    return { dryRun: false, postUrn, url: postUrl(postUrn), imageBytes };
  }

  return { name: 'linkedin', publish };
}

module.exports = { createLinkedInPublisher, UncertainPublishError };
