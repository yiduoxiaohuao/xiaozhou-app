// ============================================================
// 🚢 小舟单词 PWA — v10.0
// 纯真实英语词汇 12分类 5131词（历史1175词）
// ============================================================

;(async function() {
  'use strict'

  const decks = await loadDecks()
  let userProgress = loadProgress()

  // ---------- SM-2 ----------
  const SM2 = {
    calc(quality, rep, ease, interval) {
      if (quality < 2) rep = 0; else rep++
      let ni; if (rep === 1) ni = 1; else if (rep === 2) ni = 6; else ni = Math.round(interval * ease)
      let ne = ease + (0.1 - (2 - quality) * (0.08 + (2 - quality) * 0.02))
      if (ne < 1.3) ne = 1.3
      return { ease: ne, interval: ni, repetitions: rep, nextReview: Date.now() + ni * 86400000, status: rep === 0 ? 'learning' : 'reviewing' }
    }
  }

  // ---------- 工具 ----------
  function loadDecks() { return fetch('data/decks.json').then(r => r.json()).then(function(d){ d.forEach(function(deck){ deck.words.forEach(function(w){ w._phon = w.phonetic || '' }) }); return d }) }
  function loadProgress() {
    try { const d = localStorage.getItem('xz_progress'); if (d) return JSON.parse(d) } catch(e) {}
    return { words: {}, strandedDecks: [], checkIn: { totalDays: 0, currentStreak: 0, longestStreak: 0, todayStudied: 0, lastStudyDate: null }, extraToday: [], extraWords: {} }
  }
  function saveProgress() { try { localStorage.setItem('xz_progress', JSON.stringify(userProgress)) } catch(e) {} }
  function getDateKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') }
  function getTodayKey() { return getDateKey(Date.now()) }
  function $(id) { return document.getElementById(id) }

  function showToast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg
    document.body.appendChild(t); setTimeout(() => t.remove(), 2000)
  }
  function confirmDialog(title, text) {
    return new Promise(resolve => {
      const overlay = document.createElement('div'); overlay.className = 'modal-overlay'
      overlay.innerHTML = `<div class="modal-box"><div class="modal-title">${title}</div><div class="modal-text">${text}</div><div class="modal-actions"><button class="btn-cancel">取消</button><button class="btn-confirm">确定</button></div></div>`
      document.body.appendChild(overlay)
      overlay.querySelector('.btn-cancel').onclick = () => { overlay.remove(); resolve(false) }
      overlay.querySelector('.btn-confirm').onclick = () => { overlay.remove(); resolve(true) }
    })
  }

  // ====== 🔊 发音 —— 华为 Mate 80 (HarmonyOS) 深度兼容方案 ======
  // 华为浏览器中 Web Speech API 有按钮动画但无声音输出
  // 使用固定 hidden <audio> 元素 + 有道词典真实语音 API
  // 华为要求音频必须在用户手势（click/touch）同步调用 play()

  // 全局隐藏 <audio> 元素（只创建一个，复用）
  var _hwAudio = null
  var _hwAudioReady = false

  function _setupAudio() {
    if (_hwAudio) return
    _hwAudio = document.createElement('audio')
    _hwAudio.id = '_hidden-speaker'
    _hwAudio.style.display = 'none'
    _hwAudio.preload = 'auto'
    document.body.appendChild(_hwAudio)
  }

  // 预热：创建 AudioContext 并生成一个极短的静音来激活音频通道
  function _warmupAudio() {
    if (_hwAudioReady) return
    _hwAudioReady = true
    _setupAudio()
    try {
      // Web Audio API 解锁（华为需要）
      var AC = window.AudioContext || window.webkitAudioContext
      if (AC) {
        var ctx = new AC()
        if (ctx.state === 'suspended') ctx.resume()
      }
    } catch(e) {}
    // 播放一个静音 wav 来彻底解锁
    try {
      _hwAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
      _hwAudio.volume = 0.01
      var p = _hwAudio.play()
      if (p && p.catch) p.catch(function(){})
    } catch(e) {}
  }

  document.addEventListener('click', _warmupAudio, { once: true })
  document.addEventListener('touchstart', _warmupAudio, { once: true })

  window.speakWord = function speakWord(text, lang) {
    if (!text) return
    // 非真实单词不发音也不报错（机器生成词无声）
    if (!_isRealWord(text)) return
    
    _setupAudio()
    _warmupAudio()
    
    var encoded = encodeURIComponent(text)
    var url = 'https://dict.youdao.com/dictvoice?audio=' + encoded + '&type=0'
    
    _hwAudio.pause()
    _hwAudio.removeAttribute('src')
    _hwAudio.load()
    
    // 错误处理：静默降级到英式发音
    _hwAudio.onerror = function() {
      var url2 = 'https://dict.youdao.com/dictvoice?audio=' + encoded + '&type=1'
      _hwAudio.src = url2
      _hwAudio.load()
      _hwAudio.play().catch(function() {})
    }
    
    _hwAudio.src = url
    _hwAudio.volume = 1.0
    _hwAudio.currentTime = 0
    
    var playPromise = _hwAudio.play()
    if (playPromise && playPromise.catch) {
      playPromise.catch(function(err) {
        setTimeout(function() {
          _hwAudio.load()
          var p2 = _hwAudio.play()
          if (p2 && p2.catch) p2.catch(function() {
            try { var tmp = new Audio(url); tmp.volume = 1.0; tmp.play().catch(function(){}) } catch(e) {}
          })
        }, 200)
      })
    }
  }
  
  // 安全转义函数，防止特殊字符破坏 onclick
  function _esc(str) {
    return (str || '').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/[<>]/g,'').replace(/\\/g,'\\\\')
  }

  // 判断是否真实单词（非机器生成的复合词/派生词）
  // 词库中带 _ 的词都是代码批量生成的伪单词
  function _isRealWord(word) {
    if (!word) return false
    var w = word.trim()
    // 含下划线或空格的 99.9% 是生成的
    if (w.indexOf('_') >= 0) return false
    if (w.indexOf(' ') >= 0) return false
    // 含数字的也是生成的
    if (/[0-9]/.test(w)) return false
    // 太长的也是生成的（超过 25 个字符）
    if (w.length > 25) return false
    return true
  }

  // ====== 📢 真实音标获取（有道词典 API，标准 IPA 格式）======
  var _phonCache = {}
  function getPhonetic(word, callback) {
    if (!word || !callback) { if (callback) callback(''); return }
    var w = word.toLowerCase().trim()
    // 非真实单词直接跳过
    if (!_isRealWord(w)) { callback(''); return }
    
    if (_phonCache[w]) { callback(_phonCache[w]); return }
    
    // 有道词典 JSON API
    var xhr = new XMLHttpRequest()
    xhr.open('GET', 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(w), true)
    xhr.timeout = 4000
    xhr.onload = function() {
      try {
        var d = JSON.parse(xhr.responseText)
        var phon = ''
        if (d.ec && d.ec.word && d.ec.word[0]) {
          phon = d.ec.word[0].usphone || d.ec.word[0].ukphone || ''
        } else if (d.baes && d.baes.word && d.baes.word[0] && d.baes.word[0].usphone) {
          phon = d.baes.word[0].usphone || ''
        }
        if (phon) {
          phon = '/' + phon.trim() + '/'
          _phonCache[w] = phon
          callback(phon)
          return
        }
      } catch(e) {}
      callback('')
    }
    xhr.onerror = function() { callback('') }
    xhr.ontimeout = function() { callback('') }
    xhr.send()
  }

  // 翻卡全局函数（供 innerHTML 的内联 onclick 调用）
  window._flipCardToBack = function() {
    var f = document.getElementById('card-front'); var b = document.getElementById('card-back'); var a = document.getElementById('study-actions')
    if (!f || !b) return
    f.style.display = 'none'; b.style.display = 'flex'
    if (a) a.style.display = 'flex'
  }
  window._flipCardToFront = function() {
    var f = document.getElementById('card-front'); var b = document.getElementById('card-back'); var a = document.getElementById('study-actions')
    if (!f || !b) return
    f.style.display = 'flex'; b.style.display = 'none'
    if (a) a.style.display = 'none'
  }

  // ---------- 进度 ----------
  function getTodayStats() {
    const words = userProgress.words
    const total = Object.keys(words).length
    const learning = Object.values(words).filter(w => w.status === 'learning').length
    const reviewing = Object.values(words).filter(w => w.status === 'reviewing').length
    const due = Object.entries(words).filter(([,w]) => w.status === 'reviewing' && w.nextReview <= Date.now()).length
    const todayStudied = userProgress.checkIn.lastStudyDate === getTodayKey() ? userProgress.checkIn.todayStudied : 0
    const extraCount = Array.isArray(userProgress.extraToday) ? userProgress.extraToday.length : 0
    return { total, learning, reviewing, due, todayStudied, extraCount,
      totalDays: userProgress.checkIn.totalDays, currentStreak: userProgress.checkIn.currentStreak, longestStreak: userProgress.checkIn.longestStreak }
  }

  function updateProgress(wordId, quality) {
    if (quality < 0 || quality > 2) return
    const prev = userProgress.words[wordId]
    const e = prev ? prev.ease : 2.5, i = prev ? prev.interval : 0, r = prev ? prev.repetitions : 0
    const res = SM2.calc(quality, r, e, i)
    userProgress.words[wordId] = { ...res, lastReview: Date.now() }

    const today = getTodayKey()
    if (userProgress.checkIn.lastStudyDate !== today) {
      userProgress.checkIn.todayStudied = 1; userProgress.checkIn.lastStudyDate = today
    } else { userProgress.checkIn.todayStudied++ }
    saveProgress()
  }

  function toggleExtraWord(wordId) {
    if (!Array.isArray(userProgress.extraToday)) userProgress.extraToday = []
    const idx = userProgress.extraToday.indexOf(wordId)
    if (idx >= 0) { userProgress.extraToday.splice(idx, 1); saveProgress(); return false }
    else { userProgress.extraToday.push(wordId); saveProgress(); return true }
  }
  function isExtraWord(wordId) { return Array.isArray(userProgress.extraToday) && userProgress.extraToday.includes(wordId) }

  function findWord(wordId) {
    for (const d of decks) for (const w of d.words) if (w.id === wordId) return { deck: d, word: w }
    return null
  }
  function getDeckById(id) { return decks.find(d => d.id === id) }
  function getDeckIdForWord(wid) { for (const d of decks) for (const w of d.words) if (w.id === wid) return d.id; return null }
  function getWordStatus(wid) {
    const rec = userProgress.words[wid]
    if (!rec) return { text: '新词', cls: 'tag-new', icon: '🆕' }
    if (rec.status === 'learning') return { text: '学习中', cls: 'tag-learning', icon: '📖' }
    if (rec.status === 'reviewing' && rec.nextReview > Date.now()) return { text: '待复习', cls: 'tag-due', icon: '⚠️' }
    if (rec.repetitions >= 3) return { text: '已掌握', cls: 'tag-mastered', icon: '✅' }
    return { text: '待复习', cls: 'tag-due', icon: '⚠️' }
  }
  function formatDate(ts) { const d = new Date(ts); return d.getMonth()+1 + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') }
  function formatDateShort(ts) { const d = new Date(ts); return d.getMonth()+1 + '/' + d.getDate() }

  const catMeta = {
    history: { icon: '🏯', name: '中国历史', color: '#e65100' },
    accounting: { icon: '📊', name: '会计专业', color: '#1565c0' },
    travel: { icon: '✈️', name: '旅行日常', color: '#2e7d32' },
    daily: { icon: '👕', name: '生活日常', color: '#6a1b9a' },
    general: { icon: '📚', name: '通用核心', color: '#37474f' },
    academic: { icon: '🎓', name: '学术词汇', color: '#00695c' },
    science: { icon: '💻', name: '科学技术', color: '#00838f' },
    business: { icon: '💼', name: '商业管理', color: '#4527a0' },
    legal: { icon: '⚖️', name: '法律政府', color: '#c62828' },
    medical: { icon: '🏥', name: '医疗健康', color: '#2e7d32' },
    food: { icon: '🍳', name: '饮食烹饪', color: '#e65100' },
    emotion: { icon: '💕', name: '情感关系', color: '#ad1457' }
  }

  // ---------- 页面状态 ----------
  let studyState = { deck: null, queue: [], index: 0, flipped: false, done: false, count: 0, hard: 0, ok: 0, easy: 0 }
  let translateState = { matchedWords: [], sentences: [], articleBackDeckId: null }

  function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    const page = $(pageId)
    if (page) page.classList.add('active')
    document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.page === pageId))
    if (pageId === 'page-index') renderHome()
    else if (pageId === 'page-review') renderReview()
    else if (pageId === 'page-profile') renderProfile()
  }

  // ============================================================
  // 🏠 首页
  // ============================================================
  function renderHome() {
    const stats = getTodayStats()
    $('home-stats').innerHTML = `
      <div class="stat-item"><div class="num">${stats.todayStudied}</div><div class="label">今日学习</div></div>
      <div class="stat-item"><div class="num">${stats.total}</div><div class="label">已学单词</div></div>
      <div class="stat-item"><div class="num">${stats.due}</div><div class="label">待复习</div></div>
      <div class="stat-item"><div class="num">${stats.currentStreak}</div><div class="label">连续${stats.currentStreak}天</div></div>
    `

    const cats = {}
    decks.forEach(d => { if (!cats[d.category]) cats[d.category] = []; cats[d.category].push(d) })

    const container = $('home-categories'); container.innerHTML = ''
    Object.entries(catMeta).forEach(([key, meta]) => {
      const list = cats[key] || []
      const totalWords = list.reduce((s, d) => s + d.words.length, 0)
      const card = document.createElement('div'); card.className = 'category-card'
      const header = document.createElement('div'); header.className = 'category-header'
      header.innerHTML = `
        <div class="cat-icon">${meta.icon}</div>
        <div class="cat-info"><div class="cat-name">${meta.name}</div><div class="cat-desc">${list.length} 个词库 · ${totalWords} 词</div></div>
        <div class="cat-arrow">▼</div>
      `
      const body = document.createElement('div'); body.className = 'category-body'
      list.forEach(d => {
        const learned = d.words.filter(w => userProgress.words[w.id]).length
        const item = document.createElement('div'); item.className = 'deck-item'
        item.innerHTML = `<div class="di-icon">${d.icon}</div><div class="di-info"><div class="di-title">${d.title}</div><div class="di-desc">${d.desc} · 已学${learned}/${d.words.length}</div></div><div class="di-count">${d.words.length}词</div>`
        item.onclick = () => showDeck(d.id)
        body.appendChild(item)
      })
      let open = false
      header.onclick = () => { open = !open; header.classList.toggle('open', open); body.classList.toggle('open', open) }
      card.appendChild(header); card.appendChild(body); container.appendChild(card)
    })
  }

  // ============================================================
  // 📂 词库详情
  // ============================================================
  function showDeck(deckId) {
    const deck = getDeckById(deckId)
    if (!deck) { showToast('词库未找到'); return }
    history.pushState({ page: 'deck', deckId }, '', '#deck-' + deckId)
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    $('page-deck').classList.add('active')

    $('deck-header').innerHTML = `<span class="back" onclick="window.history.back()">‹</span><span class="title">${deck.icon} ${deck.title}</span>`
    $('deck-info').innerHTML = `<div class="card"><div style="text-align:center"><div style="font-size:48px">${deck.icon}</div><div style="font-size:20px;font-weight:700;margin:8px 0">${deck.title}</div><div style="font-size:14px;color:var(--text-secondary)">${deck.desc}</div><div style="font-size:13px;color:var(--text-light);margin-top:6px">共 ${deck.words.length} 个单词 · 已学 ${deck.words.filter(w => userProgress.words[w.id]).length} 个</div></div></div>`

    const list = $('deck-words'); list.innerHTML = ''
    deck.words.forEach(w => {
      const st = getWordStatus(w.id)
      const extra = isExtraWord(w.id)
      const safeEn = _esc(w.en)
      const item = document.createElement('div'); item.className = 'word-item'
      // 初始不显示音标（去掉了假的），等 API 异步返回再显示
      var _initPh = w._phon || ''
      item.innerHTML = `<div class="wi-info"><div class="wi-en">${w.en} <span class="_ph-${w.id}" style="font-size:12px;color:var(--text-light)">${_initPh}</span><span style="float:right;font-size:12px;font-weight:400;padding:2px 8px;border-radius:10px;background:var(--bg)">${st.icon} ${st.text}</span></div><div class="wi-cn">${w.cn}</div></div><button class="speak-btn" onclick="event.stopPropagation();speakWord('${safeEn}')" style="flex-shrink:0">🔊</button><button class="extra-btn ${extra?'on':''}" data-wid="${w.id}">${extra?'⭐':'☆'}</button>`
      item.onclick = (e) => { if (!e.target.closest('.speak-btn') && !e.target.closest('.extra-btn')) showWordDetail(w.id, deckId) }
      const eb = item.querySelector('.extra-btn')
      eb.onclick = (e) => { e.stopPropagation(); const added = toggleExtraWord(w.id); eb.textContent = added ? '⭐' : '☆'; eb.classList.toggle('on', added); showToast(added ? '已加入今日额外练' : '已移除') }
      list.appendChild(item)
      // 异步获取真实音标（只调用一次，结果缓存）
      if (!w._phon) {
        getPhonetic(w.en, function(phon) {
          if (phon) {
            w._phon = phon
            var el = document.querySelector('._ph-' + w.id)
            if (el) el.textContent = phon
          }
        })
      }
    })
    $('deck-study-btn').onclick = () => startStudy(deckId)
    $('deck-study-btn').textContent = '开始学习 (' + deck.words.length + ' 词)'
  }

  // ============================================================
  // 🃏 翻卡学习 — 支持正反面来回翻
  // ============================================================
  function startStudy(deckId) {
    const deck = getDeckById(deckId)
    if (!deck) return
    history.pushState({ page: 'study', deckId }, '', '#study-' + deckId)
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    $('page-study').classList.add('active')
    $('study-header').innerHTML = `<span class="back" onclick="window.history.back()">‹</span><span class="title">📖 ${deck.icon} ${deck.title}</span>`

    const extraSet = new Set(Array.isArray(userProgress.extraToday) ? userProgress.extraToday : [])
    const extra = deck.words.filter(w => extraSet.has(w.id))
    const due = deck.words.filter(w => {
      const r = userProgress.words[w.id]; return r && r.status === 'reviewing' && r.nextReview <= Date.now() && !extraSet.has(w.id)
    })
    const newWords = deck.words.filter(w => !userProgress.words[w.id] && !extraSet.has(w.id))
    const queue = [...extra, ...due, ...newWords]

    if (queue.length === 0) {
      $('study-content').innerHTML = `<div class="study-done"><div class="done-icon">🎉</div><div class="done-title">全部学完！</div><div style="color:var(--text-secondary);margin-bottom:16px">该词库所有单词都已学习</div><button class="btn btn-primary" onclick="window.history.back()">返回词库</button></div>`
      return
    }
    studyState = { deck, queue, index: 0, flipped: false, done: false, count: 0, hard: 0, ok: 0, easy: 0 }
    renderFlashcard()
    // 按钮绑定在 renderFlashcard 中完成
  }

  function renderFlashcard() {
    const state = studyState
    if (state.done || state.index >= state.queue.length) {
      state.done = true
      $('study-content').innerHTML = `<div class="study-done"><div class="done-icon">🎉</div><div class="done-title">学习完成！</div><div class="done-stats"><div>✅ 认识 ${state.easy} 个</div><div>🤔 模糊 ${state.ok} 个</div><div>✗ 不认识 ${state.hard} 个</div></div><div style="color:var(--text-secondary);margin:12px 0">本次学习 ${state.count} 个单词</div><button class="btn btn-primary" onclick="window.history.back()" style="max-width:200px;margin:auto">返回词库</button></div>`
      return
    }

    const w = state.queue[state.index]
    const p = state.index + 1; const total = state.queue.length
    state.flipped = false
    const ext = isExtraWord(w.id)
    const safeEn = _esc(w.en)
    var _ph = (w._phon || ''), ex = (w.example||''), st = (w.story||''), pct = Math.round(p/total*100)
    const en = (w.en||''), cn = (w.cn||'')
    
    // 异步获取真实音标（首次）
    if (!w._phon) {
      getPhonetic(w.en, function(phon) {
        if (phon) {
          w._phon = phon; _ph = phon
          var pe = document.getElementById('_ph-card')
          if (pe) pe.textContent = phon
        }
      })
    }
    
    // 使用内联 onclick 避免 innerHTML 后事件绑定失效（华为浏览器兼容）
    $('study-content').innerHTML = `
      <div class="study-progress">
        <div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
        <div class="study-counter">${p} / ${total} ${ext ? '⭐' : ''}</div>
      </div>
      <div class="flashcard-container">
        <div class="flashcard" id="flashcard">
          <div class="flashcard-face" id="card-front" onclick="_flipCardToBack()">
            <div style="font-size:28px;font-weight:700;margin-bottom:8px">${en}</div>
            <div style="font-size:16px;color:#888" id="_ph-card">${_ph}</div>
            <button class="speak-btn" onclick="event.stopPropagation();speakWord('${safeEn}')"><span class="sb-icon">🔊</span> 发音</button>
            <div style="margin-top:20px;font-size:13px;color:#999">👆 点击翻面看释义</div>
          </div>
          <div class="flashcard-face" id="card-back" style="display:none;justify-content:flex-start;padding:30px 20px" onclick="_flipCardToFront()">
            <div style="font-size:22px;font-weight:700;color:var(--primary);margin-bottom:8px">${cn}</div>
            <div style="font-size:14px;color:#666;margin-bottom:12px">${ex}</div>
            <div style="font-size:13px;color:#888;line-height:1.6">📖 ${st}</div>
            <button class="speak-btn" style="margin-top:16px" onclick="event.stopPropagation();speakWord('${safeEn}')"><span class="sb-icon">🔊</span> 再听一遍</button>
            <div style="margin-top:12px;font-size:12px;color:#999">👆 点击翻回正面</div>
          </div>
        </div>
      </div>
      <div class="study-actions" id="study-actions" style="display:none">
        <button class="btn btn-hard" onclick="answerStudy(0)">✗ 不认识</button>
        <button class="btn btn-ok" onclick="answerStudy(1)">🤔 模糊</button>
        <button class="btn btn-easy" onclick="answerStudy(2)">✓ 认识</button>
      </div>
    `
  }

  function answerStudy(quality) {
    const state = studyState
    if (state.done) return
    const w = state.queue[state.index]
    updateProgress(w.id, quality)
    state.count++
    if (quality === 0) state.hard++
    else if (quality === 1) state.ok++
    else state.easy++
    state.index++
    state.flipped = false
    renderFlashcard()
  }

  // ============================================================
  // ⭐ 今日额外练习
  // ============================================================
  function startExtraStudy() {
    const extraIds = Array.isArray(userProgress.extraToday) ? userProgress.extraToday : []
    if (extraIds.length === 0) { showToast('还没有添加额外练习的单词'); return }
    const extraWords = []
    for (const d of decks) for (const w of d.words) { if (extraIds.includes(w.id)) extraWords.push({ ...w, deckTitle: d.title, deckId: d.id }) }
    if (extraWords.length === 0) { showToast('单词数据未找到'); return }

    history.pushState({ page: 'study-extra' }, '', '#study-extra')
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    $('page-study').classList.add('active')
    $('study-header').innerHTML = `<span class="back" onclick="window.history.back()">‹</span><span class="title">⭐ 今日额外练习 (${extraWords.length})</span>`

    studyState = { deck: null, queue: extraWords, index: 0, flipped: false, done: false, count: 0, hard: 0, ok: 0, easy: 0 }
    renderFlashcard()
    // 按钮绑定在 renderFlashcard 中完成
  }

  function answerExtraStudy(quality) {
    const state = studyState; if (state.done) return
    const w = state.queue[state.index]
    updateProgress(w.id, quality)
    if (!userProgress.extraWords) userProgress.extraWords = {}
    userProgress.extraWords[w.id] = (userProgress.extraWords[w.id] || 0) + 1
    saveProgress()
    state.count++; if (quality === 0) state.hard++; else if (quality === 1) state.ok++; else state.easy++
    state.index++; state.flipped = false
    if (state.index >= state.queue.length) {
      state.done = true
      $('study-content').innerHTML = `<div class="study-done"><div class="done-icon">🎉</div><div class="done-title">额外练习完成！</div><div class="done-stats"><div>✅ ${state.easy} 个</div><div>🤔 ${state.ok} 个</div><div>✗ ${state.hard} 个</div></div><div style="color:var(--text-secondary);margin:12px 0">本次练习 ${state.count} 次</div><button class="btn btn-primary" onclick="showPage('page-profile')" style="max-width:200px;margin:auto">返回我的</button></div>`
      return
    }
    renderFlashcard()
  }

  // ============================================================
  // 📝 文章翻译 — 精确匹配 + 点词学习
  // ============================================================
  // 文件上传事件绑定（修复 v3.0 遗漏的 onchange）
  document.addEventListener('DOMContentLoaded', function() {
    $('file-camera-input').onchange = (e) => handleFiles(e.target.files, 'camera')
    $('file-image-input').onchange = (e) => handleFiles(e.target.files, 'image')
    $('file-doc-input').onchange = (e) => handleFiles(e.target.files, 'doc')
  })
  // 立即绑定（因为 script 在 body 之后执行）
  if ($('file-camera-input')) {
    $('file-camera-input').onchange = (e) => handleFiles(e.target.files, 'camera')
    $('file-image-input').onchange = (e) => handleFiles(e.target.files, 'image')
    $('file-doc-input').onchange = (e) => handleFiles(e.target.files, 'doc')
  }

  let uploadedFiles = []
  $('upload-camera').onclick = () => $('file-camera-input').click()
  $('upload-image').onclick = () => $('file-image-input').click()
  $('upload-file').onclick = () => $('file-doc-input').click()

  async function handleFiles(files, type) {
    if (!files || !files.length) return
    for (const f of files) {
      uploadedFiles.push(f)
      const item = document.createElement('div'); item.className = 'up-item'
      const icon = type === 'doc' ? '📄' : '🖼️'
      item.innerHTML = `<span class="up-icon">${icon}</span><span class="up-name">${f.name}</span><span class="up-remove">✕</span>`
      item.querySelector('.up-remove').onclick = () => { uploadedFiles = uploadedFiles.filter(uf => uf !== f); item.remove() }
      $('upload-preview').appendChild(item)
    }
    showToast('正在提取文字...')
    try {
      const texts = []
      for (const f of files) {
        const t = type === 'doc' ? await readDocFile(f) : await ocrImage(f)
        if (t) texts.push(t)
      }
      const combined = texts.join('\n\n')
      if (combined.trim()) {
        $('translate-input').value += ($('translate-input').value ? '\n' : '') + combined
        showToast('文字已提取')
      }
      $('upload-preview').innerHTML = ''; uploadedFiles = []
    } catch(e) { showToast('提取失败: ' + e.message) }
  }

  async function ocrImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          if (typeof Tesseract === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js')
          const { data } = await Tesseract.recognize(e.target.result, 'chi_sim+eng', {
            logger: m => { if (m.status === 'recognizing text') $('translate-btn').textContent = '识别中 ' + Math.round(m.progress*100) + '%' }
          })
          resolve(data.text)
        } catch(err) { reject(err) }
        finally { $('translate-btn').textContent = '提取文章中的单词' }
      }
      reader.onerror = reject; reader.readAsDataURL(file)
    })
  }

  async function readDocFile(file) {
    const name = file.name.toLowerCase()
    if (name.endsWith('.txt') || name.endsWith('.md')) return file.text()
    if (name.endsWith('.docx')) {
      if (typeof mammoth === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js')
      const buf = await file.arrayBuffer(); const { value } = await mammoth.extractRawText({ arrayBuffer: buf }); return value
    }
    if (name.endsWith('.pdf')) { showToast('PDF将以图片方式识别'); return ocrImage(file) }
    return file.text()
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s)
    })
  }

  // 翻译按钮：精准匹配中文→词库单词
  $('translate-btn').onclick = async function() {
    const text = $('translate-input').value.trim()
    if (!text) { showToast('请先输入中文文章'); return }
    const btn = this; btn.disabled = true; btn.textContent = '匹配中...'
    $('translate-result').classList.remove('open')
    await new Promise(r => setTimeout(r, 300))

    // 建立词库索引：中文 → 单词（多个单词可能共享同一中文释义）
    const cnIndex = new Map()
    for (const d of decks) {
      for (const w of d.words) {
        const cn = w.cn.replace(/[：，。！？、；：""''（）《》]/g, '').trim()
        if (!cn) continue
        // 如果 cn 包含冒号或括号，用主要部分
        const mainCn = cn.split(/[/（(]/)[0].trim()
        if (!cnIndex.has(mainCn)) cnIndex.set(mainCn, [])
        cnIndex.get(mainCn).push({ word: w, deck: d })
      }
    }

    // 分句
    const sentences = text.split(/[。！？\n]+/).filter(s => s.trim()).map(s => s.trim())

    // 在每句中匹配词汇（逐字组合匹配）
    const allMatchedIds = new Set()
    const sentenceMatches = sentences.map(s => {
      const matchedWords = []
      const cnKeys = Array.from(cnIndex.keys()).sort((a, b) => b.length - a.length) // 长词优先
      for (const key of cnKeys) {
        if (s.includes(key)) {
          const refs = cnIndex.get(key) || []
          for (const ref of refs) {
            if (!allMatchedIds.has(ref.word.id)) {
              matchedWords.push(ref)
              allMatchedIds.add(ref.word.id)
            }
          }
        }
      }
      return { text: s, matches: matchedWords }
    })

    // 如果有未匹配到的句子，补充高频词作为学习建议
    const matchedCount = allMatchedIds.size

    // 渲染
    let html = ''

    // 逐句展示（含匹配到的单词标注）
    let sentencesHtml = sentenceMatches.map(sm => {
      if (sm.matches.length === 0) {
        return `<div class="tl-sentence">
          <div class="tl-original">${sm.text}</div>
          <div style="font-size:13px;color:var(--text-light);margin-top:4px">📭 未匹配到词库中的单词</div>
        </div>`
      }
      // 把匹配到的中文词高亮展示
      let highlighted = sm.text
      for (const m of sm.matches) {
        const cn = m.word.cn.split(/[/（(]/)[0].trim()
        highlighted = highlighted.replaceAll(cn, `<span class="tl-word" data-wid="${m.word.id}">${cn}</span>`)
      }
      return `<div class="tl-sentence">
        <div class="tl-original">${highlighted}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:6px">🔍 匹配到 ${sm.matches.length} 个单词</div>
      </div>`
    }).join('')

    html += `<div class="card"><h4 style="margin-bottom:8px">📖 文章匹配结果</h4>${sentencesHtml}</div>`

    // 提取的单词列表
    const matchedWords = []
    for (const sm of sentenceMatches) {
      for (const m of sm.matches) {
        if (!matchedWords.find(x => x.word.id === m.word.id)) matchedWords.push(m)
      }
    }
    translateState.matchedWords = matchedWords

    let wordsHtml = matchedWords.map(m => {
      const w = m.word
      const st = getWordStatus(w.id)
      const safeEn = _esc(w.en)
      var _phTl = w._phon || ''
      return `<div class="tl-word-item" onclick="(function(){window._tlBack=function(){showPage('page-translate')};showWordDetail('${w.id}','${m.deck.id}',true)})()">
        <div class="wi-info"><div class="wi-en">${w.en} <span class="_pht-${w.id}" style="font-size:12px;color:var(--text-light)">${_phTl}</span></div><div class="wi-cn">${w.cn} · ${st.icon}${st.text}</div></div>
        <button class="speak-btn" onclick="event.stopPropagation();speakWord('${safeEn}')" style="flex-shrink:0">🔊</button>
      </div>`
    }).join('')

    html += `<div class="card"><h4 style="margin-bottom:8px">📋 匹配到的单词（${matchedWords.length} 个）· 点击可学习</h4><div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">点击单词进入详情，学完后点「← 返回文章」回到这里</div>${wordsHtml}</div>`

    $('translate-result').innerHTML = html

    // 绑定句中单词点击
    $('translate-result').querySelectorAll('.tl-word').forEach(el => {
      el.onclick = () => {
        const wid = el.dataset.wid
        window._tlBack = function() { showPage('page-translate') }
        showWordDetail(wid, getDeckIdForWord(wid) || null, true)
      }
    })

    // 异步获取匹配单词的真实音标
    matchedWords.forEach(function(m) {
      if (!m.word._phon) {
        getPhonetic(m.word.en, function(phon) {
          if (phon) {
            m.word._phon = phon
            var el = document.querySelector('._pht-' + m.word.id)
            if (el) el.textContent = phon
          }
        })
      }
    })

    $('translate-result').classList.add('open')
    btn.disabled = false; btn.textContent = '提取文章中的单词'
  }

  // ============================================================
  // 🔄 复习中心
  // ============================================================
  function renderReview() {
    const stats = getTodayStats()
    $('review-stats').innerHTML = `<div class="stat-item"><div class="num">${stats.due}</div><div class="label">待复习</div></div><div class="stat-item"><div class="num">${stats.todayStudied}</div><div class="label">已复习</div></div><div class="stat-item"><div class="num">${stats.currentStreak}</div><div class="label">连续天数</div></div><div class="stat-item"><div class="num">${stats.total}</div><div class="label">总学习</div></div>`

    const dueWords = [], masteredWords = [], allWords = []
    Object.entries(userProgress.words).forEach(([id, rec]) => {
      const fw = findWord(id); if (!fw) return
      const item = { ...rec, word: fw.word, deckTitle: fw.deck.title, deckIcon: fw.deck.icon }
      allWords.push(item)
      if (rec.status === 'reviewing' && rec.nextReview <= Date.now()) dueWords.push(item)
      if (rec.repetitions >= 3) masteredWords.push(item)
    })
    dueWords.sort((a, b) => a.nextReview - b.nextReview)
    masteredWords.sort((a, b) => b.lastReview - a.lastReview)
    allWords.sort((a, b) => b.lastReview - a.lastReview)

    let curTab = 'due'
    function renderTab(t) {
      curTab = t
      document.querySelectorAll('.review-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === t))
      const list = t === 'due' ? dueWords.slice(0, 50) : t === 'mastered' ? masteredWords : allWords
      const container = $('review-words'); container.innerHTML = ''
      if (list.length === 0) { container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div>暂无单词</div></div>'; return }
      list.forEach(item => {
        const progress = item.repetitions >= 3 ? 100 : Math.min(Math.round(item.repetitions/3*100), 99)
        const d = document.createElement('div'); d.className = 'word-item'
        d.innerHTML = `<div class="wi-info"><div class="wi-en">${item.word.en} <span style="font-size:12px;color:var(--text-light)">${item.word.cn}</span><span style="float:right;font-size:11px;color:var(--text-light)">${item.deckIcon} ${item.deckTitle}</span></div><div style="font-size:11px;color:var(--text-light);margin-top:4px">复习: ${formatDate(item.lastReview)} | 下次: ${item.nextReview?formatDate(item.nextReview):'-'}</div><div class="progress-bar" style="height:4px;margin-top:6px"><div class="fill" style="width:${progress}%"></div></div></div>`
        d.onclick = () => showWordDetail(item.word.id)
        container.appendChild(d)
      })
    }

    $('review-tabs').innerHTML = `<div class="review-tab active" data-tab="due">待复习 (${dueWords.length})</div><div class="review-tab" data-tab="mastered">已掌握 (${masteredWords.length})</div><div class="review-tab" data-tab="all">全部 (${allWords.length})</div>`
    document.querySelectorAll('.review-tab').forEach(el => el.onclick = () => renderTab(el.dataset.tab))
    renderTab('due')

    $('review-study-btn').onclick = () => {
      if (dueWords.length === 0) { showToast('没有待复习的单词'); return }
      const deckCounts = {}
      dueWords.forEach(w => { const f = findWord(w.word.id); if (f) deckCounts[f.deck.id] = (deckCounts[f.deck.id] || 0) + 1 })
      const best = Object.entries(deckCounts).sort((a,b) => b[1]-a[1])[0]
      if (best) startStudy(best[0])
    }
  }

  // ============================================================
  // 📖 单词详情（支持 fromTranslate 返回）
  // ============================================================
  function showWordDetail(wordId, deckId, fromTranslate) {
    const result = findWord(wordId)
    if (!result) { showToast('单词未找到'); return }
    history.pushState({ page: 'word-detail', wordId, fromTranslate: !!fromTranslate }, '', '#word-'+wordId)
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    $('page-word-detail').classList.add('active')

    const { word, deck } = result
    const st = getWordStatus(word.id)
    const rec = userProgress.words[word.id]
    const extra = isExtraWord(word.id)
    const safeEn = _esc(word.en)
    var _phWd = (word._phon || '')

    $('wd-header').innerHTML = `<span class="back" onclick="window.history.back()">‹</span><span class="title">${deck.icon} ${deck.title}</span>`
    $('wd-content').innerHTML = `
      <div class="wd-word">
        <div class="wd-en">${word.en}</div>
        <div class="wd-phonetic" id="_ph-wd">${_phWd}</div>
        <div class="wd-cn">${word.cn}</div>
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <span style="padding:2px 12px;border-radius:12px;background:var(--bg);font-size:13px">${st.icon} ${st.text}</span>
          ${extra?'<span style="padding:2px 12px;border-radius:12px;background:#fff3e0;font-size:13px;color:#e65100">⭐ 今日额外练</span>':''}
        </div>
        <button class="speak-btn" onclick="speakWord('${safeEn}')" style="margin:12px auto"><span class="sb-icon">🔊</span> 听发音</button>
      </div>
      <div class="card wd-section"><div class="ws-label">💬 例句</div><div class="ws-content">${word.example||'暂无例句'}</div></div>
      <div class="card wd-section"><div class="ws-label">📖 联想故事</div><div class="ws-content">${word.story||'暂无联想故事'}</div></div>
      ${rec ? `<div class="card"><div class="stat-row"><div class="stat-item"><div class="num" style="font-size:16px">${rec.repetitions}</div><div class="label">复习次数</div></div><div class="stat-item"><div class="num" style="font-size:16px">${rec.ease.toFixed(1)}</div><div class="label">记忆系数</div></div><div class="stat-item"><div class="num" style="font-size:16px">${rec.interval}天</div><div class="label">间隔</div></div></div></div>` : ''}
      <div style="display:flex;gap:10px;padding:8px 0">
        <button class="btn btn-secondary" id="wd-extra-btn" style="flex:1">${extra?'⭐ 已加入':'☆ 加入今日额外练'}</button>
        <button class="btn btn-primary" onclick="startStudy('${deck.id}')" style="flex:2">开始学习</button>
      </div>
      ${fromTranslate ? '<button class="btn btn-secondary" onclick="if(window._tlBack)window._tlBack();else showPage(\'page-translate\')" style="width:100%">← 返回文章</button>' : ''}
    `
    // 异步获取真实音标
    getPhonetic(word.en, function(phon) {
      if (phon && phon !== _phWd) {
        word._phon = phon
        var el = document.getElementById('_ph-wd')
        if (el) el.textContent = phon
      }
    })
    $('wd-extra-btn').onclick = () => {
      const added = toggleExtraWord(word.id)
      $('wd-extra-btn').textContent = added ? '⭐ 已加入' : '☆ 加入今日额外练'
      showToast(added ? '已加入' : '已移除')
    }
  }

  // ============================================================
  // 👤 个人中心
  // ============================================================
  function renderProfile() {
    const stats = getTodayStats()
    const extraIds = Array.isArray(userProgress.extraToday) ? userProgress.extraToday : []

    $('profile-stats').innerHTML = `<div class="stat-item"><div class="num">${stats.total}</div><div class="label">已学单词</div></div><div class="stat-item"><div class="num">${Object.values(userProgress.words).filter(w=>w.repetitions>=3).length}</div><div class="label">已掌握</div></div><div class="stat-item"><div class="num">${stats.due}</div><div class="label">待复习</div></div><div class="stat-item"><div class="num">${stats.currentStreak}</div><div class="label">连续${stats.currentStreak}天</div></div>`

    const extraWords = []
    for (const d of decks) for (const w of d.words) { if (extraIds.includes(w.id)) extraWords.push(w) }

    $('profile-extra').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-weight:600">⭐ 今日额外练习 (${extraWords.length})</span>
        ${extraWords.length>0?'<button class="speak-btn" onclick="startExtraStudy()" style="padding:6px 16px">开始练习</button>':''}
      </div>
      ${extraWords.length===0?'<div style="color:var(--text-light);font-size:13px">在词库或单词详情中点击 ☆ 加入额外练习</div>'
        : extraWords.map(w => {
            const cnt = userProgress.extraWords[w.id] || 0
            return `<div class="word-item" style="margin-bottom:2px;padding:8px 12px" onclick="showWordDetail('${w.id}')"><div class="wi-info"><div class="wi-en">${w.en}</div><div class="wi-cn">${w.cn} · 已练${cnt}次</div></div></div>`
          }).join('')}
    `

    $('api-key').value = localStorage.getItem('xz_apikey') || ''
    $('api-url').value = localStorage.getItem('xz_apiurl') || 'https://api.openai.com/v1/chat/completions'
    $('save-settings').onclick = () => {
      const key = $('api-key').value.trim(); const url = $('api-url').value.trim()
      if (key) localStorage.setItem('xz_apikey', key)
      if (url) localStorage.setItem('xz_apiurl', url)
      showToast('已保存')
    }
    $('clear-data').onclick = async () => {
      const ok = await confirmDialog('确认清除', '将删除所有学习数据，不可恢复。')
      if (ok) { userProgress = { words:{}, strandedDecks:[], checkIn:{totalDays:0,currentStreak:0,longestStreak:0,todayStudied:0,lastStudyDate:null}, extraToday:[], extraWords:{} }; saveProgress(); showToast('已清除'); renderProfile() }
    }
    $('about-app').onclick = () => showToast('小舟单词 v3.0 · 68个词库 · 8000单词')
  }

  // ============================================================
  // 🧭 路由
  // ============================================================
  window.addEventListener('popstate', e => {
    if (e.state && e.state.page) {
      if (e.state.page === 'deck') showDeck(e.state.deckId)
      else if (e.state.page === 'study' || e.state.page === 'study-extra') { if (e.state.deckId) startStudy(e.state.deckId); else showPage('page-profile') }
      else if (e.state.page === 'word-detail') { if (e.state.wordId) showWordDetail(e.state.wordId, e.state.deckId, e.state.fromTranslate) }
      else showPage('page-index')
    } else showPage('page-index')
  })

  document.querySelectorAll('.tab-item').forEach(el => {
    el.onclick = () => { showPage(el.dataset.page); history.pushState({ page: el.dataset.page }, '', '#' + el.dataset.page) }
  })

  // ============================================================
  // 暴露关键函数到全局（供内联 onclick 属性调用）
  // ============================================================
  window.answerStudy = answerStudy
  window.startStudy = startStudy
  window.startExtraStudy = startExtraStudy
  window.showPage = showPage
  window.showWordDetail = showWordDetail
  window.isExtraWord = isExtraWord
  window.toggleExtraWord = toggleExtraWord
  window._renderHome = renderHome
  window._esc = _esc
  window.getPhonetic = getPhonetic

  // ============================================================
  // 🚀 启动
  // ============================================================
  showPage('page-index')
  history.replaceState({ page: 'index' }, '', '#')
})()
