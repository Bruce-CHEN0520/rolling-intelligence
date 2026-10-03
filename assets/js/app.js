/*!
 * app.js —— 博客前端（hash 路由 + 无依赖渲染）
 * 视图：首页 / 文章详情 / 标签总览 / 标签详情 / 关于
 */
(function () {
  'use strict';

  var SITE = window.BLOG_SITE || {};
  var POSTS = (window.BLOG_POSTS || []).slice();
  var ABOUT = window.BLOG_ABOUT || '';
  var md = window.MiniMarkdown;

  var app = document.getElementById('app');
  var topbar = document.querySelector('.topbar');
  var progressEl = document.getElementById('progress');

  var state = { query: '', tocObserver: null, scrollMemory: {}, current: '/' };

  /* ---------------- 工具 ---------------- */

  var COVERS = [
    ['#0d2b3a', '#1d6f8f'],
    ['#0f2f28', '#1f8a63'],
    ['#241a3d', '#6b4ea8'],
    ['#3a2116', '#a2603a'],
    ['#0b2636', '#3d7fa8'],
    ['#2f2038', '#8a5a9e'],
    ['#1b2a12', '#5d8a2a']
  ];

  function hashCode(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100003;
    return h;
  }

  function coverStyle(post) {
    if (post.cover) {
      return 'background-image:url(\'' + post.cover + '\');background-size:cover;background-position:center;';
    }
    var pair = COVERS[hashCode(post.tags[0] || post.slug) % COVERS.length];
    return '--cover-a:' + pair[0] + ';--cover-b:' + pair[1] + ';';
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    return m[1] + ' 年 ' + parseInt(m[2], 10) + ' 月 ' + parseInt(m[3], 10) + ' 日';
  }

  function shortDate(iso) { return (iso || '').slice(0, 10); }

  function tagIndex() {
    var map = {};
    POSTS.forEach(function (post) {
      (post.tags || []).forEach(function (tag) {
        map[tag] = (map[tag] || 0) + 1;
      });
    });
    return Object.keys(map).map(function (tag) {
      return { tag: tag, count: map[tag] };
    }).sort(function (a, b) { return b.count - a.count || a.tag.localeCompare(b.tag); });
  }

  function findPost(slug) {
    for (var i = 0; i < POSTS.length; i++) if (POSTS[i].slug === slug) return POSTS[i];
    return null;
  }

  function filterPosts(query, tag) {
    var q = (query || '').trim().toLowerCase();
    return POSTS.filter(function (post) {
      if (tag && (post.tags || []).indexOf(tag) === -1) return false;
      if (!q) return true;
      var hay = [post.title, post.summary, (post.tags || []).join(' '), post.plain || ''].join(' ').toLowerCase();
      return q.split(/\s+/).every(function (part) { return hay.indexOf(part) !== -1; });
    });
  }

  function totalTags() { return tagIndex().length; }

  function setDocTitle(suffix) {
    document.title = suffix ? suffix + ' · ' + SITE.title : SITE.title + ' · ' + SITE.subtitle;
  }

  /* ---------------- 路由 ---------------- */

  function parseHash() {
    var raw = location.hash.replace(/^#/, '');
    if (!raw) raw = '/';
    var query = {};
    var qi = raw.indexOf('?');
    if (qi !== -1) {
      raw.slice(qi + 1).split('&').forEach(function (pair) {
        if (!pair) return;
        var kv = pair.split('=');
        query[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      });
      raw = raw.slice(0, qi);
    }
    var parts = raw.split('/').filter(Boolean).map(function (p) {
      try { return decodeURIComponent(p); } catch (e) { return p; }
    });
    return { parts: parts, query: query, path: '/' + parts.join('/') };
  }

  function go(path) {
    if (location.hash === '#' + path) { render(); return; }
    location.hash = path;
  }

  /* ---------------- 视图：首页 ---------------- */

  function viewHome(route) {
    var tag = route.parts[0] === 'tag' ? route.parts[1] : '';
    var posts = filterPosts(state.query, tag);
    var allTags = tagIndex();

    var hero = '' +
      '<section class="hero">' +
      '<div class="hero-bg"></div>' +
      '<div class="hero-inner">' +
      '<p class="hero-kicker">' + esc(SITE.titleEn || 'Personal Blog') + '</p>' +
      '<h1>' + esc(SITE.subtitle || '').replace(/ × /g, ' <span class="grad">×</span> ') + '</h1>' +
      '<p class="lead">' + esc(SITE.description || '') + '</p>' +
      '<div class="hero-stats">' +
      '<span class="stat"><b>' + POSTS.length + '</b> 篇文章</span>' +
      '<span class="stat"><b>' + totalTags() + '</b> 个标签</span>' +
      '<span class="stat"><b>' + esc(SITE.author || '') + '</b> 的笔记</span>' +
      '</div>' +
      '</div>' +
      '</section>';

    var chips = '<div class="chips">' +
      '<a class="chip' + (tag ? '' : ' is-active') + '" href="#/">全部<span class="count">' + POSTS.length + '</span></a>' +
      allTags.map(function (item) {
        return '<a class="chip' + (tag === item.tag ? ' is-active' : '') + '" href="#/tag/' +
          encodeURIComponent(item.tag) + '">' + esc(item.tag) + '<span class="count">' + item.count + '</span></a>';
      }).join('') +
      '</div>';

    var toolbar = '' +
      '<div class="toolbar">' +
      '<h2 class="section-title">' + (tag ? '标签：' + esc(tag) : (state.query ? '搜索结果' : '最新文章')) + '</h2>' +
      '<label class="search">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="search-input" type="search" placeholder="搜索标题、标签或正文…" value="' + esc(state.query) + '" autocomplete="off">' +
      '<kbd>/</kbd>' +
      '</label>' +
      '</div>' + chips;

    var grid = posts.length
      ? '<div class="grid">' + posts.map(function (post, i) {
        return cardHtml(post, i);
      }).join('') + '</div>'
      : '<div class="empty"><strong>没有匹配的文章</strong>换个关键词，或者 <a href="#/">回到全部文章</a>。</div>';

    return hero + '<div class="container">' + toolbar + grid + '</div>';
  }

  function cardHtml(post, index) {
    return '' +
      '<article class="card reveal" style="animation-delay:' + Math.min(index * 40, 320) + 'ms">' +
      '<a class="card-cover" href="#/post/' + encodeURIComponent(post.slug) + '" style="' + coverStyle(post) + '">' +
      '<span class="cover-label">' + esc((post.tags || [])[0] || '笔记') + '</span>' +
      '</a>' +
      '<div class="card-body">' +
      '<h3><a href="#/post/' + encodeURIComponent(post.slug) + '">' + esc(post.title) + '</a></h3>' +
      '<p>' + esc(post.summary) + '</p>' +
      '<div class="card-tags">' + (post.tags || []).map(function (t) {
        return '<a class="tag-pill" href="#/tag/' + encodeURIComponent(t) + '">' + esc(t) + '</a>';
      }).join('') + '</div>' +
      '<div class="card-meta">' +
      '<span>' + esc(shortDate(post.date)) + '</span>' +
      '<span class="dot"></span>' +
      '<span>' + post.readingMinutes + ' 分钟</span>' +
      '<span style="margin-left:auto;color:var(--accent)">阅读 →</span>' +
      '</div>' +
      '</div>' +
      '</article>';
  }

  /* ---------------- 视图：文章详情 ---------------- */

  function viewPost(route) {
    var slug = route.parts[1];
    var post = findPost(slug);
    if (!post) return viewNotFound();

    var parsed = md.parse(post.content || '');
    var idx = POSTS.indexOf(post);
    var newer = POSTS[idx - 1];
    var older = POSTS[idx + 1];

    var toc = parsed.headings.filter(function (h) { return h.level === 2 || h.level === 3; });
    var tocHtml = toc.length
      ? '<aside class="toc"><p class="toc-title">本文目录</p><ol>' +
        toc.map(function (h) {
          return '<li class="lv-' + h.level + '"><a href="#/post/' + encodeURIComponent(post.slug) +
            '?h=' + encodeURIComponent(h.id) + '" data-toc="' + esc(h.id) + '">' + esc(h.text) + '</a></li>';
        }).join('') + '</ol></aside>'
      : '';

    var navHtml = '<nav class="post-nav">' +
      (older
        ? '<a href="#/post/' + encodeURIComponent(older.slug) + '"><span class="dir">← 上一篇</span><div class="t">' + esc(older.title) + '</div></a>'
        : '<span class="spacer"></span>') +
      (newer
        ? '<a class="next" href="#/post/' + encodeURIComponent(newer.slug) + '"><span class="dir">下一篇 →</span><div class="t">' + esc(newer.title) + '</div></a>'
        : '<span class="spacer"></span>') +
      '</nav>';

    setDocTitle(post.title);

    return '' +
      '<div class="container">' +
      '<header class="post-head">' +
      '<p class="breadcrumb"><a href="#/">首页</a> / <a href="#/tag/' + encodeURIComponent((post.tags || [])[0] || '') + '">' +
      esc((post.tags || [])[0] || '文章') + '</a> / 正文</p>' +
      '<div class="card-tags">' + (post.tags || []).map(function (t) {
        return '<a class="tag-pill" href="#/tag/' + encodeURIComponent(t) + '">' + esc(t) + '</a>';
      }).join('') + '</div>' +
      '<h1>' + esc(post.title) + '</h1>' +
      '<div class="post-meta">' +
      '<span>' + formatDate(post.date) + '</span><span class="dot"></span>' +
      '<span>约 ' + post.readingMinutes + ' 分钟</span><span class="dot"></span>' +
      '<span>' + post.chars + ' 字</span>' +
      '</div>' +
      '</header>' +
      '<div class="post-layout">' +
      '<article class="prose" id="post-body">' + parsed.html + navHtml + '</article>' +
      tocHtml +
      '</div>' +
      '</div>';
  }

  /* ---------------- 视图：标签 ---------------- */

  function viewTags() {
    var tags = tagIndex();
    var cloud = '<div class="tag-cloud">' + tags.map(function (item) {
      return '<a href="#/tag/' + encodeURIComponent(item.tag) + '">' + esc(item.tag) +
        '<span class="count">' + item.count + '</span></a>';
    }).join('') + '</div>';

    var groups = tags.map(function (item) {
      var posts = filterPosts('', item.tag);
      return '<section class="tag-group">' +
        '<div class="tag-group-head"><span class="bar"></span>' + esc(item.tag) +
        '<span style="color:var(--muted);font-weight:400;font-size:13px">' + item.count + ' 篇</span></div>' +
        '<ul class="mini-list">' + posts.map(function (post) {
          return '<li><a href="#/post/' + encodeURIComponent(post.slug) + '">' +
            '<span class="date">' + esc(shortDate(post.date)) + '</span>' +
            '<span class="t">' + esc(post.title) + '</span>' +
            '<span class="m">' + post.readingMinutes + ' 分钟</span>' +
            '</a></li>';
        }).join('') + '</ul></section>';
    }).join('');

    setDocTitle('标签');
    return '<div class="container">' +
      '<header class="post-head"><h1>标签分类</h1>' +
      '<p class="lead" style="color:var(--text-2);margin:12px 0 0">共 ' + tags.length +
      ' 个标签，按文章数量排序。点击任意标签可查看该主题下的全部文章。</p>' + cloud + '</header>' +
      groups + '<div style="height:60px"></div></div>';
  }

  /* ---------------- 视图：关于 ---------------- */

  function viewAbout() {
    var parsed = md.parse(ABOUT);
    var profile = '' +
      '<aside class="profile">' +
      '<div class="profile-avatar"></div>' +
      '<h2>' + esc(SITE.author || '') + '</h2>' +
      '<p class="role">' + esc(SITE.role || '') + '</p>' +
      '<ul class="meta-list">' +
      '<li><span class="k">城市</span><span>' + esc(SITE.city || '—') + '</span></li>' +
      '<li><span class="k">邮箱</span><span>' + esc(SITE.email || '—') + '</span></li>' +
      '<li><span class="k">文章</span><span>' + POSTS.length + ' 篇</span></li>' +
      '<li><span class="k">标签</span><span>' + totalTags() + ' 个</span></li>' +
      '</ul>' +
      '</aside>';

    setDocTitle('关于');
    return '<div class="container"><div class="about-layout">' + profile +
      '<article class="prose" id="post-body">' + parsed.html + '</article>' +
      '</div></div>';
  }

  function viewNotFound() {
    setDocTitle('页面不存在');
    return '<div class="container"><div class="empty" style="margin-top:70px">' +
      '<strong>找不到这个页面</strong>它可能已被移动或删除。<a href="#/">返回首页</a></div></div>';
  }

  /* ---------------- 渲染与绑定 ---------------- */

  function render() {
    var route = parseHash();
    var path = route.path;

    // 记录滚动位置，返回时恢复
    if (state.current && state.current !== path) {
      state.scrollMemory[state.current] = window.scrollY;
    }

    var html;
    if (route.parts.length === 0) html = viewHome(route);
    else if (route.parts[0] === 'post') html = viewPost(route);
    else if (route.parts[0] === 'tags') html = viewTags();
    else if (route.parts[0] === 'tag') html = viewHome(route);
    else if (route.parts[0] === 'about') html = viewAbout();
    else html = viewNotFound();

    if (route.parts.length === 0) setDocTitle('');

    app.innerHTML = html;
    state.current = path;

    // 导航高亮
    document.querySelectorAll('.nav a').forEach(function (link) {
      var target = (link.getAttribute('href') || '').replace(/^#/, '');
      var active = (target === '/' && route.parts.length === 0) ||
        (target === '/tags' && (route.parts[0] === 'tags' || route.parts[0] === 'tag')) ||
        (target === '/about' && route.parts[0] === 'about');
      link.classList.toggle('is-active', !!active);
    });

    bindView(route);

    // 滚动位置
    if (route.query.h) {
      var target = document.getElementById(route.query.h);
      if (target) {
        requestAnimationFrame(function () { target.scrollIntoView({ block: 'start' }); });
      }
    } else if (state.scrollMemory[path]) {
      var y = state.scrollMemory[path];
      requestAnimationFrame(function () { window.scrollTo(0, y); });
    } else {
      window.scrollTo(0, 0);
    }
  }

  function bindView(route) {
    var isPost = route.parts[0] === 'post' && document.getElementById('post-body');

    // 搜索框
    var input = document.getElementById('search-input');
    if (input) {
      input.addEventListener('input', function () {
        state.query = input.value;
        var pos = input.selectionStart;
        render();
        var next = document.getElementById('search-input');
        if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (e) {} }
      });
    }

    // 目录高亮 + 阅读进度
    if (state.tocObserver) { state.tocObserver.disconnect(); state.tocObserver = null; }
    if (isPost) {
      var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
      var heads = links.map(function (a) { return document.getElementById(a.getAttribute('data-toc')); }).filter(Boolean);
      if (heads.length && 'IntersectionObserver' in window) {
        state.tocObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            links.forEach(function (a) {
              a.classList.toggle('is-active', a.getAttribute('data-toc') === entry.target.id);
            });
          });
        }, { rootMargin: '-84px 0px -70% 0px', threshold: 0 });
        heads.forEach(function (h) { state.tocObserver.observe(h); });
      }
      updateProgress();
    } else if (progressEl) {
      progressEl.style.width = '0%';
    }
  }

  function updateProgress() {
    if (!progressEl) return;
    var body = document.getElementById('post-body');
    if (!body) { progressEl.style.width = '0%'; return; }
    var start = body.offsetTop;
    var total = body.offsetHeight - window.innerHeight * 0.6;
    var ratio = total > 0 ? (window.scrollY - start + window.innerHeight * 0.35) / total : 0;
    progressEl.style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
  }

  /* ---------------- 全局事件 ---------------- */

  document.addEventListener('click', function (event) {
    var copyBtn = event.target.closest('[data-copy]');
    if (copyBtn) {
      var block = copyBtn.closest('.code-block');
      var code = block ? block.querySelector('code') : null;
      if (!code) return;
      copyText(code.innerText, function () {
        copyBtn.textContent = '已复制';
        copyBtn.classList.add('is-done');
        setTimeout(function () {
          copyBtn.textContent = '复制';
          copyBtn.classList.remove('is-done');
        }, 1600);
      });
      return;
    }

    var anchor = event.target.closest('[data-anchor]');
    if (anchor) {
      var id = anchor.getAttribute('data-anchor');
      var route = parseHash();
      var url = location.origin + location.pathname + '#/post/' +
        encodeURIComponent(route.parts[1] || '') + '?h=' + encodeURIComponent(id);
      copyText(url, function () {
        var old = anchor.textContent;
        anchor.textContent = '已复制链接';
        setTimeout(function () { anchor.textContent = old; }, 1400);
      });
    }
  });

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
  }

  // 主题
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('blog-theme', theme); } catch (e) {}
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.setAttribute('aria-label', theme === 'dark' ? '切换到浅色' : '切换到深色');
      btn.innerHTML = theme === 'dark'
        ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
        : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    }
  }

  document.getElementById('theme-toggle').addEventListener('click', function () {
    var now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(now);
  });

  // 键盘：/ 聚焦搜索，Esc 清空
  document.addEventListener('keydown', function (event) {
    var tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (event.key === 'Escape') {
        state.query = '';
        event.target.value = '';
        event.target.blur();
        render();
      }
      return;
    }
    if (event.key === '/') {
      var input = document.getElementById('search-input');
      if (input) { event.preventDefault(); input.focus(); }
    }
  });

  // 滚动
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      if (topbar) topbar.classList.toggle('is-stuck', window.scrollY > 6);
      updateProgress();
    });
  }, { passive: true });

  window.addEventListener('hashchange', render);

  /* ---------------- 启动 ---------------- */

  (function init() {
    var theme = 'dark';
    try { theme = localStorage.getItem('blog-theme') || 'dark'; } catch (e) {}
    applyTheme(theme);

    // 注入站点图片
    var root = document.documentElement.style;
    if (SITE.heroImage) root.setProperty('--hero-image', 'url("' + SITE.heroImage + '")');
    if (SITE.avatarImage) root.setProperty('--avatar-image', 'url("' + SITE.avatarImage + '")');

    var build = document.getElementById('build-stamp');
    if (build) build.textContent = window.BLOG_BUILD || '';

    render();
  })();
})();
