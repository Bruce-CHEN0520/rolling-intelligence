/*!
 * markdown.js —— 轻量 Markdown 渲染器（零依赖）
 *
 * 支持语法：
 *   标题 (# ~ ######)      段落（含硬换行）
 *   围栏代码块 (``` / ~~~)  引用 (>，可嵌套)
 *   有序 / 无序列表（可嵌套） 表格（GFM，支持对齐）
 *   分隔线                  行内代码
 *   粗体 / 斜体 / 删除线 / 高亮
 *   链接 / 图片             任务列表 (- [x])
 *
 * 输出：{ html, headings, plain }
 *   headings 用于生成文章目录（TOC）
 */
(function (global) {
  'use strict';

  var HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var CJK_RE = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
  var PLACEHOLDER = '\u0000';

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) { return HTML_ESCAPE[ch]; });
  }

  function stripMarkup(text) {
    return String(text)
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`=#]/g, '')
      .trim();
  }

  function slugify(text) {
    var t = stripMarkup(text).toLowerCase();
    t = t.replace(/[^\w\u4e00-\u9fff\-\s]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
    return t || 'section';
  }

  /* ------------------------------------------------------------------ *
   * 行内解析
   * ------------------------------------------------------------------ */
  function inline(text) {
    var store = [];
    var s = escapeHtml(text);

    // 行内代码优先，先摘出来避免被后续规则破坏
    s = s.replace(/`([^`]+)`/g, function (m, code) {
      store.push('<code>' + code + '</code>');
      return PLACEHOLDER + (store.length - 1) + PLACEHOLDER;
    });

    // 图片
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g, function (m, alt, src) {
      return '<img src="' + src + '" alt="' + alt + '" loading="lazy">';
    });

    // 链接
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g, function (m, label, href) {
      var external = /^https?:\/\//i.test(href);
      return '<a href="' + href + '"' +
        (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';
    });

    // 强调
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

    // 还原行内代码
    s = s.replace(/\u0000(\d+)\u0000/g, function (m, idx) { return store[+idx]; });
    return s;
  }

  /* ------------------------------------------------------------------ *
   * 工具
   * ------------------------------------------------------------------ */
  function isBlank(line) {
    return /^\s*$/.test(line);
  }

  function matchListItem(line) {
    var m = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/.exec(line);
    if (!m) return null;
    return {
      indent: m[1].replace(/\t/g, '    ').length,
      ordered: /\d/.test(m[2]),
      marker: m[2],
      text: m[4]
    };
  }

  /** 段落内多行合并：中文之间不补空格，英文之间补空格；支持行尾硬换行 */
  function renderLines(lines) {
    var out = '';
    var pendingBreak = false;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var hard = / {2,}$/.test(raw) || /\\$/.test(raw);
      var clean = raw.replace(/\\\s*$/, '').trim();
      if (i > 0) {
        if (pendingBreak) {
          out += '<br>';
        } else if (!(CJK_RE.test(out.slice(-1)) || CJK_RE.test(clean.charAt(0)))) {
          out += ' ';
        }
      }
      out += inline(clean);
      pendingBreak = hard;
    }
    return out;
  }

  function renderCodeBlock(code, lang) {
    var label = lang || 'text';
    return '<div class="code-block" data-lang="' + escapeHtml(label) + '">' +
      '<div class="code-head"><span class="code-lang">' + escapeHtml(label) + '</span>' +
      '<button class="code-copy" type="button" data-copy>复制</button></div>' +
      '<pre><code class="language-' + escapeHtml(label) + '">' + escapeHtml(code) + '</code></pre>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ *
   * 块级解析
   * ------------------------------------------------------------------ */
  function renderBlocks(lines, ctx) {
    var out = [];
    var i = 0;

    function isTableStart(idx) {
      if (idx + 1 >= lines.length) return false;
      if (lines[idx].indexOf('|') === -1) return false;
      var sep = lines[idx + 1];
      return /^\s*\|?[\s:|-]+\|?\s*$/.test(sep) && sep.indexOf('-') !== -1;
    }

    function isBlockStart(idx) {
      var line = lines[idx];
      if (isBlank(line)) return true;
      if (/^\s*(```|~~~)/.test(line)) return true;
      if (/^#{1,6}\s/.test(line)) return true;
      if (/^\s*>\s?/.test(line)) return true;
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return true;
      if (/^\s*([-*+]|\d{1,9}[.)])\s+/.test(line)) return true;
      if (isTableStart(idx)) return true;
      return false;
    }

    function splitCells(line) {
      var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      return s.split('|').map(function (c) { return c.trim(); });
    }

    function parseTable(start) {
      var heads = splitCells(lines[start]);
      var aligns = splitCells(lines[start + 1]).map(function (c) {
        var left = c.charAt(0) === ':';
        var right = c.charAt(c.length - 1) === ':';
        if (left && right) return 'center';
        if (right) return 'right';
        return 'left';
      });
      var rows = [];
      var j = start + 2;
      while (j < lines.length && !isBlank(lines[j]) && lines[j].indexOf('|') !== -1) {
        rows.push(splitCells(lines[j]));
        j++;
      }
      var html = '<div class="table-wrap"><table><thead><tr>';
      heads.forEach(function (h, idx) {
        html += '<th style="text-align:' + (aligns[idx] || 'left') + '">' + inline(h) + '</th>';
      });
      html += '</tr></thead><tbody>';
      rows.forEach(function (row) {
        html += '<tr>';
        for (var c = 0; c < heads.length; c++) {
          html += '<td style="text-align:' + (aligns[c] || 'left') + '">' + inline(row[c] || '') + '</td>';
        }
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      return { html: html, next: j };
    }

    function parseList(start, baseIndent) {
      var first = matchListItem(lines[start]);
      var ordered = first.ordered;
      var items = [];
      var j = start;

      while (j < lines.length) {
        var li = matchListItem(lines[j]);
        if (!li || li.indent < baseIndent) break;

        // 更深缩进 → 属于上一项的嵌套列表
        if (li.indent > baseIndent) {
          var sub = parseList(j, li.indent);
          if (items.length) {
            items[items.length - 1].children.push(sub.html);
          } else {
            items.push({ text: '', children: [sub.html] });
          }
          j = sub.next;
          continue;
        }

        if (li.ordered !== ordered) break;

        var item = { text: li.text, children: [] };
        j++;

        while (j < lines.length) {
          var cur = lines[j];

          if (isBlank(cur)) {
            var k = j + 1;
            while (k < lines.length && isBlank(lines[k])) k++;
            var after = k < lines.length ? matchListItem(lines[k]) : null;
            if (after && after.indent >= baseIndent) { j = k; break; }   // 松散列表，继续
            if (k < lines.length && /^\s{2,}\S/.test(lines[k])) {         // 项内第二段
              item.text += '\n\n' + lines[k].trim();
              j = k + 1;
              continue;
            }
            j = k;
            break;
          }

          var nl = matchListItem(cur);
          if (nl) break;                                                  // 交给外层处理
          if (/^(#{1,6}\s|>|```|~~~)/.test(cur.trim())) break;
          if (isTableStart(j)) break;
          if (!isBlank(cur)) {
            item.text += '\n' + cur.trim();
            j++;
            continue;
          }
          break;
        }

        items.push(item);
      }

      var tag = ordered ? 'ol' : 'ul';
      var startAttr = '';
      if (ordered && first.marker !== '1.' && first.marker !== '1)') {
        startAttr = ' start="' + parseInt(first.marker, 10) + '"';
      }

      var html = '<' + tag + startAttr + '>';
      items.forEach(function (it) {
        var paragraphs = String(it.text).split(/\n{2,}/).map(function (p) {
          return renderLines(p.split('\n'));
        });
        var body = paragraphs.length > 1
          ? paragraphs.map(function (p) { return '<p>' + p + '</p>'; }).join('')
          : (paragraphs[0] || '');

        // 任务列表
        body = body.replace(/^\[([ xX])\]\s+/, function (m, mark) {
          return '<span class="task-box' + (mark === ' ' ? '' : ' task-box--done') + '"></span>';
        });

        html += '<li>' + body + it.children.join('') + '</li>';
      });
      html += '</' + tag + '>';

      return { html: html, next: j };
    }

    while (i < lines.length) {
      var line = lines[i];

      if (isBlank(line)) { i++; continue; }

      // 围栏代码块
      var fence = /^\s*(```+|~~~+)\s*([^\s`]*)\s*$/.exec(line);
      if (fence) {
        var lang = fence[2] || '';
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*(```+|~~~+)\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        out.push(renderCodeBlock(buf.join('\n'), lang));
        continue;
      }

      // 标题
      var heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        var level = heading[1].length;
        var rawTitle = heading[2].replace(/\s+#+\s*$/, '').trim();
        var id = slugify(rawTitle);
        if (ctx.used[id]) {
          ctx.used[id] += 1;
          id = id + '-' + ctx.used[id];
        } else {
          ctx.used[id] = 1;
        }
        ctx.headings.push({ level: level, id: id, text: stripMarkup(rawTitle) });
        out.push('<h' + level + ' id="' + id + '">' + inline(rawTitle) +
          '<span class="md-anchor" role="button" tabindex="0" data-anchor="' + id +
          '" title="复制该小节链接">#</span></h' + level + '>');
        i++;
        continue;
      }

      // 分隔线
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // 引用（可嵌套）
      if (/^\s*>\s?/.test(line)) {
        var quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + renderBlocks(quote, ctx) + '</blockquote>');
        continue;
      }

      // 表格
      if (isTableStart(i)) {
        var table = parseTable(i);
        out.push(table.html);
        i = table.next;
        continue;
      }

      // 列表
      if (matchListItem(line)) {
        var list = parseList(i, matchListItem(line).indent);
        out.push(list.html);
        i = list.next;
        continue;
      }

      // 缩进代码块
      if (/^ {4,}\S/.test(line)) {
        var code = [];
        while (i < lines.length && (/^ {4,}/.test(lines[i]) || isBlank(lines[i]))) {
          code.push(lines[i].replace(/^ {4}/, ''));
          i++;
        }
        while (code.length && isBlank(code[code.length - 1])) code.pop();
        out.push(renderCodeBlock(code.join('\n'), ''));
        continue;
      }

      // 段落
      var para = [];
      while (i < lines.length && !isBlockStart(i)) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) out.push('<p>' + renderLines(para) + '</p>');
    }

    return out.join('\n');
  }

  function parse(markdown) {
    var ctx = { headings: [], used: {} };
    var lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');
    var html = renderBlocks(lines, ctx);
    return { html: html, headings: ctx.headings };
  }

  global.MiniMarkdown = { parse: parse, inline: inline, escapeHtml: escapeHtml, slugify: slugify };
})(typeof window !== 'undefined' ? window : this);
