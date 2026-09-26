


import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';
import hljs from '../vendor/hljs-es/core.js';
import javascript from '../vendor/hljs-es/javascript.js';
import typescript from '../vendor/hljs-es/typescript.js';
import python from '../vendor/hljs-es/python.js';
import json from '../vendor/hljs-es/json.js';
import bash from '../vendor/hljs-es/bash.js';
import xml from '../vendor/hljs-es/xml.js';
import css from '../vendor/hljs-es/css.js';
import markdown from '../vendor/hljs-es/markdown.js';
import sql from '../vendor/hljs-es/sql.js';
import yaml from '../vendor/hljs-es/yaml.js';
import ini from '../vendor/hljs-es/ini.js';
import rust from '../vendor/hljs-es/rust.js';
import go from '../vendor/hljs-es/go.js';
import java from '../vendor/hljs-es/java.js';
import csharp from '../vendor/hljs-es/csharp.js';
import cpp from '../vendor/hljs-es/cpp.js';
import php from '../vendor/hljs-es/php.js';
import ruby from '../vendor/hljs-es/ruby.js';
import diff from '../vendor/hljs-es/diff.js';
import { h, copyText } from './ui.js';
import { icon } from './icons.js';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('diff', diff);

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(text, { highlight = true } = {}) {
  const raw = marked.parse(String(text || ''));
  const clean = DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  });
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;

  
  tpl.content.querySelectorAll('pre > code').forEach((code) => {
    const pre = code.parentElement;
    let lang = null;
    for (const cls of code.classList) {
      if (cls.startsWith('language-')) {
        lang = cls.slice(9).toLowerCase();
        break;
      }
    }
    if (highlight && lang && hljs.getLanguage(lang)) {
      try {
        hljs.highlightElement(code);
      } catch {  }
    }
    const head = h(
      'div',
      { class: 'code-head' },
      h('span', { text: lang || 'text' }),
      h(
        'button',
        {
          class: 'icon-btn',
          title: 'Copy code',
          html: icon('copy'),
          onclick: async (e) => {
            e.preventDefault();
            await copyText(code.textContent);
            e.currentTarget.innerHTML = icon('check');
            setTimeout(() => {
              const btn = head.querySelector('.icon-btn');
              if (btn) btn.innerHTML = icon('copy');
            }, 1400);
          },
        }
      )
    );
    pre.prepend(head);
  });

  
  tpl.content.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  return tpl.content;
}

export function markdownEl(text, opts) {
  return h('div', { class: 'markdown' }, renderMarkdown(text, opts));
}



export { hljs };
