// LinkedIn post commentary uses the "little" text format, where these characters are markup.
// Unescaped, LinkedIn silently truncates the post at the first one it cannot parse.
const RESERVED = /[\\|{}@[\]()<>#*_~]/g;
// LinkedIn's limit for commentary. Checked on the escaped text: it is unclear which length LinkedIn
// counts, and refusing a borderline post is better than having it silently cut off.
const MAX_COMMENTARY = 3000;

const escapeLittleText = (text) => String(text).replace(RESERVED, '\\$&');

// The documented hashtag template, so a tag renders as a hashtag link and never as escaped text.
const hashtagTemplate = (tag) => `{hashtag|\\#|${escapeLittleText(tag.replace(/^#/, ''))}}`;

// Post text, then the AI disclaimer line, then the hashtags, separated by blank lines.
function buildCommentary({ text, disclaimer = '', hashtags = [] }) {
  const tags = hashtags.map(hashtagTemplate).join(' ');
  return [escapeLittleText(text), disclaimer && escapeLittleText(disclaimer), tags].filter(Boolean).join('\n\n');
}

module.exports = { MAX_COMMENTARY, escapeLittleText, buildCommentary };
