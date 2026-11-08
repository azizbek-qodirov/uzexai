import MarkdownIt from './vendor/markdown-it.js';

// Raw HTML stays escaped; markdown-it also rejects unsafe link protocols.
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true });
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};
// Replies must not fetch arbitrary images or tracking pixels.
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content);
markdown.renderer.rules.table_open = () => '<div class="markdown-table"><table>\n';
markdown.renderer.rules.table_close = () => '</table></div>\n';

export function renderMarkdown(text) {
  return markdown.render(String(text ?? ''));
}
