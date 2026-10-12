/*
 * Online mode - Firebase Authentication + Realtime Database.
 * IMPORTANT: Replace firebaseConfig with your own Firebase web-app config.
 * Cách cấu hình Firebase (bật Email/Password, tạo Realtime Database, dán Rules): xem HUONG_DAN_ONLINE.md
 */
(() => {
  const firebaseConfig = {
    apiKey: "AIzaSyCNmlsAI8UqAsPxuJUTGpWF-1Hv_2Khj_A",
    authDomain: "game-dan-gian-online-674dd.firebaseapp.com",
    databaseURL: "https://game-dan-gian-online-674dd-default-rtdb.firebaseio.com",
    projectId: "game-dan-gian-online-674dd",
    storageBucket: "game-dan-gian-online-674dd.firebasestorage.app",
    messagingSenderId: "965099903486",
    appId: "1:965099903486:web:99633799cd55f86dec08af"
  };
  const $ = id => document.getElementById(id);
  const NET_TIMEOUT = 10000; // chờ tối đa 10 giây cho mỗi thao tác với Realtime Database
  const CONFIG_HINT = 'Cần tạo Firebase project và điền firebaseConfig trong online.js. Xem HUONG_DAN_ONLINE.md.';
  let auth = null, db = null, user = null, roomCode = null, roomRef = null, roomListener = null, chatRef = null, historyRef = null, chatListener = null, historyListener = null;
  let role = 0, currentGame = 'caro', applyingRemote = false, lastStateJson = '';
  let busy = false, pendingAction = null, initError = '', unread = 0, chatReady = false;
  const savedHistoryKeys = new Set();
  const validConfig = !!firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY' && !!firebaseConfig.projectId && firebaseConfig.projectId !== 'YOUR_PROJECT_ID' && !!firebaseConfig.databaseURL;

  // ---------------------------------------------------------------
  // Tiện ích chung
  // ---------------------------------------------------------------
  const quiet = p => { if (p && typeof p.catch === 'function') p.catch(() => {}); return p; };

  // Firebase sẽ treo vô hạn (không báo lỗi) nếu databaseURL sai hoặc chưa tạo Realtime Database.
  // Bọc mọi thao tác mạng bằng thời gian chờ để người chơi luôn thấy thông báo.
  function withTimeout(promise, ms = NET_TIMEOUT) {
    let timer;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  }

  function message(id, text, error = false) {
    const el = $(id); if (el) { el.textContent = text; el.classList.toggle('error', error); }
  }
  function setRoomMessage(text, error = false) {
    message('roomMessage', text, error);
    document.querySelectorAll('[data-room-msg]').forEach(el => { el.textContent = text; el.classList.toggle('error', error); });
  }
  function setAuthVisible(show) { $('authOverlay')?.classList.toggle('hidden', !show); }
  function setRoomUI(show) {
    $('roomInfo')?.classList.toggle('hidden', !show);
    document.querySelectorAll('[data-room-strip]').forEach(el => el.classList.toggle('hidden', !show));
  }
  function setRoomLabels(code, roleText) {
    if ($('roomCodeLabel')) $('roomCodeLabel').textContent = code;
    if ($('roomRoleLabel')) $('roomRoleLabel').textContent = roleText;
    document.querySelectorAll('[data-room-code]').forEach(el => { el.textContent = code; });
    document.querySelectorAll('[data-room-role]').forEach(el => { el.textContent = roleText; });
  }
  function updateRoleLabel(data) {
    if (!role) return;
    const other = role === 1 ? data.guestName : data.hostName;
    setRoomLabels(roomCode || '', `Bạn là Người chơi ${role} • Đối thủ: ${other || 'đang chờ...'}`);
  }
  // Mã phòng 6 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/I)
  function randomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }
  function updateOnlineBar() {
    if ($('signedInAs')) $('signedInAs').textContent = user ? `Đang đăng nhập: ${user.email}` : 'Chưa đăng nhập';
    // Nút vẫn bấm được khi chưa đăng nhập: bấm vào sẽ hiện form đăng nhập/đăng ký
    if ($('createRoomBtn')) $('createRoomBtn').disabled = busy;
    if ($('joinRoomBtn')) $('joinRoomBtn').disabled = busy;
    if ($('logoutBtn')) $('logoutBtn').classList.toggle('hidden', !user);
    if ($('showLoginBtn')) $('showLoginBtn').classList.toggle('hidden', !!user);
  }
  function setBusy(on) { busy = on; updateOnlineBar(); }
  function formatTime(value) {
    if (!value) return 'vừa xong';
    try { return new Date(value).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return ''; }
  }

  // ---------------------------------------------------------------
  // Chat nổi + lịch sử
  // ---------------------------------------------------------------
  const chatOpen = () => { const p = $('roomTools'); return !!p && !p.classList.contains('hidden'); };
  function updateUnread() {
    const badge = $('chatBadge'); if (!badge) return;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('hidden', unread <= 0);
  }
  function setRoomTools(show) {
    $('chatToggle')?.classList.toggle('hidden', !show);
    if (!show) { $('roomTools')?.classList.add('hidden'); unread = 0; updateUnread(); }
  }
  function toggleChat() {
    const panel = $('roomTools'); if (!panel) return;
    const open = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    if (open) {
      unread = 0; updateUnread();
      const list = $('chatMessages'); if (list) list.scrollTop = list.scrollHeight;
      $('chatInput')?.focus();
    }
  }
  function showChatMessage(text, error = false) { message('chatMessage', text, error); }
  function renderChatMessage(key, item) {
    const list = $('chatMessages'); if (!list || !item) return;
    if (list.querySelector('.empty-note')) list.innerHTML = '';
    if (list.querySelector(`[data-message-id="${CSS.escape(key)}"]`)) return;
    const mine = !!user && item.uid === user.uid;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble' + (mine ? ' mine' : '');
    bubble.dataset.messageId = key;
    const author = document.createElement('strong'); author.textContent = item.name || 'Người chơi';
    const body = document.createElement('span'); body.textContent = item.text || '';
    const time = document.createElement('time'); time.textContent = formatTime(item.createdAt);
    bubble.append(author, body, time); list.appendChild(bubble);
    while (list.children.length > 40) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
    if (chatReady && !mine && !chatOpen()) { unread++; updateUnread(); }
  }
  function renderHistory(snapshot) {
    const list = $('matchHistory'); if (!list) return;
    list.innerHTML = '';
    const rows = [];
    snapshot.forEach(child => { rows.push({ key: child.key, ...child.val() }); });
    rows.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!rows.length) { list.innerHTML = '<p class="empty-note">Chưa có trận đấu được lưu.</p>'; return; }
    rows.slice(0, 20).forEach(item => {
      const row = document.createElement('div'); row.className = 'history-item';
      const title = document.createElement('strong'); title.textContent = item.game === 'caro' ? 'Cờ Caro 7×7' : 'Ô Ăn Quan';
      const result = document.createElement('div'); result.textContent = item.result || 'Ván đấu kết thúc';
      const time = document.createElement('time'); time.textContent = formatTime(item.createdAt);
      row.append(title, result, time); list.appendChild(row);
    });
  }

  // ---------------------------------------------------------------
  // Trạng thái ván đấu
  // Firebase biến mảng/đối tượng số thành kiểu khác khi đọc lại (ví dụ captured {1:..,2:..}
  // trở thành mảng). Luôn chuẩn hóa về một dạng duy nhất trước khi so sánh và gửi cho game.
  // ---------------------------------------------------------------
  function canonState(state) {
    if (!state) return null;
    if (state.kind === 'caro') {
      return {
        kind: 'caro',
        board: Array.from({ length: 49 }, (_, i) => state.board?.[i] || ''),
        turn: state.turn === 'O' ? 'O' : 'X',
        gameOver: !!state.gameOver,
        xWins: Number(state.xWins) || 0,
        oWins: Number(state.oWins) || 0
      };
    }
    const cap = p => ({ dan: Number(state.captured?.[p]?.dan) || 0, quan: Number(state.captured?.[p]?.quan) || 0 });
    return {
      kind: 'oanquan',
      board: Array.from({ length: 12 }, (_, i) => Number(state.board?.[i]) || 0),
      quanAlive: { 0: state.quanAlive?.[0] !== false, 6: state.quanAlive?.[6] !== false },
      turn: Number(state.turn) === 2 ? 2 : 1,
      captured: { 1: cap(1), 2: cap(2) },
      gameOver: !!state.gameOver
    };
  }
  function initialState(game, oldState = null) {
    return game === 'caro'
      ? canonState({ kind: 'caro', board: [], turn: 'X', gameOver: false, xWins: oldState?.xWins, oWins: oldState?.oWins })
      // Hai ô QUAN bắt đầu với 0 quân dân (quan được tính riêng bằng quanAlive), giống game.js
      : canonState({ kind: 'oanquan', board: [0,5,5,5,5,5,0,5,5,5,5,5], quanAlive: {0:true,6:true}, turn: 1, captured: {}, gameOver: false });
  }
  function hasFive(board, index, player) {
    const row = Math.floor(index / 7), col = index % 7;
    return [[0,1],[1,0],[1,1],[1,-1]].some(([dr,dc]) => {
      let total = 1;
      for (const sign of [-1,1]) { let r=row+dr*sign, c=col+dc*sign; while (r>=0 && r<7 && c>=0 && c<7 && board[r*7+c]===player) { total++; r+=dr*sign; c+=dc*sign; } }
      return total >= 5;
    });
  }
  async function saveHistoryForState(state, roomData) {
    if (!roomRef || !user || role !== 1 || !state?.gameOver) return;
    const game = roomData?.game || currentGame;
    const raw = JSON.stringify({ game, state });
    let hash = 0; for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    const key = 'm' + Math.abs(hash).toString(36);
    if (savedHistoryKeys.has(key)) return;
    savedHistoryKeys.add(key);
    const itemRef = roomRef.child('history/' + key);
    try {
      const existing = await itemRef.once('value'); if (existing.exists()) return;
      let result = 'Ván đấu kết thúc';
      if (state.kind === 'caro') {
        const winner = state.board?.some((v, i, board) => v && hasFive(board, i, v));
        result = winner ? `Người chơi ${state.turn === 'X' ? '1 (X)' : '2 (O)'} thắng` : 'Hòa';
      } else {
        const scores = state.captured || {};
        const score1 = (scores[1]?.dan || 0) + (scores[1]?.quan || 0) * 10;
        const score2 = (scores[2]?.dan || 0) + (scores[2]?.quan || 0) * 10;
        result = score1 === score2 ? `Hòa (${score1} - ${score2})` : `Người chơi ${score1 > score2 ? 1 : 2} thắng (${score1} - ${score2})`;
      }
      await itemRef.set({ game, result, createdAt: firebase.database.ServerValue.TIMESTAMP, by: user.uid });
    } catch (e) { savedHistoryKeys.delete(key); console.warn('Không lưu được lịch sử:', e); }
  }
  function openGame(game) {
    document.getElementById(game === 'caro' ? 'openCaro' : 'openOanQuan')?.click();
  }
  function dispatchState(game, state, host) {
    applyingRemote = true;
    try {
      window.dispatchEvent(new CustomEvent('online-state', { detail: { game, state, role, host } }));
    } finally {
      applyingRemote = false;
    }
  }
  // Apply the authoritative room state before opening the board. Without this,
  // the joining browser's local default board can be published over the room state.
  function applyRoomState(data) {
    const state = canonState(data?.state);
    if (!state) return;
    lastStateJson = JSON.stringify(state);
    dispatchState(data.game, state, data.host);
  }

  // ---------------------------------------------------------------
  // Đăng nhập / đăng ký email
  // ---------------------------------------------------------------
  function friendlyError(e) {
    const map = { 'auth/invalid-email':'Email không hợp lệ.', 'auth/missing-email':'Hãy nhập email.', 'auth/missing-password':'Hãy nhập mật khẩu.', 'auth/weak-password':'Mật khẩu cần ít nhất 6 ký tự.', 'auth/email-already-in-use':'Email này đã có tài khoản.', 'auth/invalid-credential':'Email hoặc mật khẩu không đúng.', 'auth/too-many-requests':'Bạn thử lại sau nhé.', 'auth/api-key-not-valid':'API key chưa hợp lệ. Hãy kiểm tra firebaseConfig trong online.js.', 'auth/operation-not-allowed':'Bạn chưa bật Email/Password trong Authentication → Sign-in method.', 'auth/network-request-failed':'Không kết nối được mạng hoặc Firebase. Hãy kiểm tra Internet và chạy website qua HTTPS/localhost.' };
    return map[e?.code] || e?.message || 'Có lỗi xảy ra.';
  }
  // Lỗi khi đọc/ghi Realtime Database, viết lại bằng tiếng Việt dễ hiểu
  function dbError(e) {
    const code = String(e?.code || ''), text = String(e?.message || e || '');
    if (code === 'timeout') return 'Không kết nối được tới Realtime Database. Hãy kiểm tra Internet, databaseURL trong online.js và bạn đã tạo Realtime Database chưa (xem HUONG_DAN_ONLINE.md).';
    if (/PERMISSION_DENIED/i.test(code + ' ' + text)) return 'Firebase từ chối quyền truy cập. Hãy dán Rules cho Realtime Database rồi bấm Publish (xem HUONG_DAN_ONLINE.md).';
    return friendlyError(e);
  }
  function showLoginForm() {
    setAuthVisible(true);
    message('authMessage', initError || (validConfig ? 'Đăng nhập hoặc tạo tài khoản để chơi online.' : CONFIG_HINT), !!initError || !validConfig);
  }
  // Chơi online cần tài khoản: hiện form đăng nhập / đăng ký email.
  // Đăng nhập xong sẽ tự làm tiếp việc đang bấm dở (tạo phòng / vào phòng).
  function requireLogin(action) {
    pendingAction = action || null;
    showLoginForm();
    setRoomMessage(initError || 'Hãy đăng nhập để chơi online.', true);
  }

  function initFirebase() {
    if (!validConfig) { initError = CONFIG_HINT; message('authMessage', initError, true); updateOnlineBar(); return; }
    if (typeof firebase === 'undefined') {
      initError = 'Không tải được thư viện Firebase. Hãy kiểm tra Internet rồi tải lại trang.';
      message('authMessage', initError, true); updateOnlineBar(); return;
    }
    try {
      firebase.initializeApp(firebaseConfig); auth = firebase.auth(); db = firebase.database();
      auth.onAuthStateChanged(nextUser => {
        user = nextUser || null; updateOnlineBar();
        if (user) {
          setAuthVisible(false);
          message('authMessage', 'Đăng nhập thành công.');
          const action = pendingAction; pendingAction = null;
          if (action === 'create') createRoom(); else if (action === 'join') joinRoom();
        } else {
          message('authMessage', 'Đăng nhập hoặc tạo tài khoản để chơi online.');
        }
      });
    } catch (e) { initError = 'Không khởi tạo được Firebase: ' + e.message; message('authMessage', initError, true); }
  }

  $('guestBtn')?.addEventListener('click', () => { pendingAction = null; setAuthVisible(false); });
  $('showLoginBtn')?.addEventListener('click', showLoginForm);
  $('loginBtn')?.addEventListener('click', async () => {
    if (!auth) return message('authMessage', initError || CONFIG_HINT, true);
    try { await auth.signInWithEmailAndPassword($('authEmail').value.trim(), $('authPassword').value); }
    catch (e) { message('authMessage', friendlyError(e), true); }
  });
  $('signupBtn')?.addEventListener('click', async () => {
    if (!auth) return message('authMessage', initError || CONFIG_HINT, true);
    try { await auth.createUserWithEmailAndPassword($('authEmail').value.trim(), $('authPassword').value); }
    catch (e) { message('authMessage', friendlyError(e), true); }
  });
  $('logoutBtn')?.addEventListener('click', async () => { await leaveRoom(); if (auth) await auth.signOut(); });
  $('showSignupHintBtn')?.addEventListener('click', () => {
    const email = $('authEmail'); if (email) email.focus();
    message('authMessage', 'Nhập email và mật khẩu ít nhất 6 ký tự, sau đó nhấn “Tạo tài khoản”.');
  });

  // ---------------------------------------------------------------
  // Phòng chơi
  // ---------------------------------------------------------------
  async function createRoom() {
    if (busy) return;
    if (!user || !db) return requireLogin('create');
    setBusy(true); setRoomMessage('Đang tạo phòng...');
    let ref = null;
    try {
      await leaveRoom();
      const game = $('roomGame').value;
      // Tìm mã chưa bị dùng để không ghi đè phòng của người khác
      let code = '';
      for (let i = 0; i < 6 && !code; i++) {
        const candidate = randomCode();
        const old = (await withTimeout(db.ref('rooms/' + candidate).once('value'))).val();
        if (!old || old.status === 'closed') code = candidate;
      }
      if (!code) throw new Error('Không tìm được mã phòng trống, hãy thử lại.');
      ref = db.ref('rooms/' + code);
      const roomData = { game, host: user.uid, hostName: user.email, guest: '', guestName: '', status: 'waiting', state: initialState(game), createdAt: firebase.database.ServerValue.TIMESTAMP };
      await withTimeout(ref.set(roomData));
      roomRef = ref; roomCode = code; role = 1; currentGame = game;
      applyRoomState(roomData);
      listenRoom();
      setRoomLabels(code, 'Bạn là Người chơi 1 • Đối thủ: đang chờ...');
      setRoomUI(true);
      setRoomMessage(`Đã tạo phòng ${code}. Gửi mã này cho bạn bè để họ vào chơi.`);
      openGame(game);
    } catch (e) {
      if (ref && roomRef !== ref) quiet(ref.remove()); // dọn phòng dở dang nếu ghi bị treo rồi mới thành công
      setRoomMessage('Không tạo được phòng: ' + dbError(e), true);
    } finally { setBusy(false); }
  }

  async function joinRoom() {
    if (busy) return;
    if (!user || !db) return requireLogin('join');
    const code = ($('roomCodeInput')?.value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return setRoomMessage('Mã phòng cần gồm 6 ký tự (chữ và số).', true);
    setBusy(true); setRoomMessage('Đang vào phòng...');
    try {
      await leaveRoom();
      const ref = db.ref('rooms/' + code);
      const data = (await withTimeout(ref.once('value'))).val();
      if (!data) return setRoomMessage('Không tìm thấy phòng này. Hãy kiểm tra lại mã phòng.', true);
      if (data.status === 'closed') return setRoomMessage('Phòng này đã đóng.', true);
      if (data.host === user.uid) return setRoomMessage('Bạn đang là chủ phòng này. Hãy gửi mã cho bạn bè.', true);
      // Giành chỗ người chơi 2 bằng transaction để hai người vào cùng lúc không đè nhau
      const claim = await withTimeout(ref.child('guest').transaction(current => (current && current !== user.uid ? undefined : user.uid)));
      if (!claim.committed) return setRoomMessage('Phòng đã đủ 2 người.', true);
      await withTimeout(ref.update({ guestName: user.email, status: 'playing' }));
      roomRef = ref; roomCode = code; role = 2; currentGame = data.game;
      applyRoomState(data);
      listenRoom();
      setRoomLabels(code, `Bạn là Người chơi 2 • Đối thủ: ${data.hostName || ''}`);
      setRoomUI(true);
      setRoomMessage('Đã vào phòng! Chúc bạn chơi vui.');
      openGame(currentGame);
    } catch (e) { setRoomMessage('Không vào được phòng: ' + dbError(e), true); }
    finally { setBusy(false); }
  }

  function listenRoom() {
    const ref = roomRef;
    roomListener = snap => {
      const data = snap.val();
      if (!data) { setRoomMessage('Phòng không còn tồn tại. Bấm “Rời phòng” để thoát.', true); return; }
      if (data.status === 'closed' && role === 2) setRoomMessage('Chủ phòng đã rời phòng. Bấm “Rời phòng” để thoát.', true);
      else if (!data.guest) setRoomMessage(role === 1 ? `Đang chờ bạn bè vào phòng. Mã phòng: ${roomCode}` : 'Đối thủ chưa vào phòng.');
      else setRoomMessage(`Đã kết nối 2 người chơi. Mã phòng: ${roomCode}`);
      updateRoleLabel(data);
      const state = canonState(data.state);
      if (state) {
        if (state.gameOver) saveHistoryForState(state, data);
        const json = JSON.stringify(state);
        if (json !== lastStateJson) { lastStateJson = json; dispatchState(data.game, state, data.host); }
      }
    };
    ref.on('value', roomListener);

    chatReady = false;
    if ($('chatMessages')) $('chatMessages').innerHTML = '<p class="empty-note">Đang tải tin nhắn...</p>';
    chatRef = ref.child('chat').limitToLast(40);
    chatListener = snap => renderChatMessage(snap.key, snap.val());
    chatRef.on('child_added', chatListener);
    // child_added của tin nhắn cũ chạy xong trước 'value': từ lúc này tin mới mới tính là chưa đọc
    quiet(chatRef.once('value').then(() => {
      chatReady = true;
      const list = $('chatMessages');
      if (list && list.querySelector('.empty-note')) list.innerHTML = '<p class="empty-note">Tin nhắn sẽ hiện ở đây.</p>';
    }));
    historyRef = ref.child('history');
    historyListener = renderHistory;
    historyRef.on('value', historyListener);
    setRoomTools(true);
  }

  // Báo cho phòng biết mình đã rời (chủ phòng: đóng phòng, khách: nhả chỗ)
  function leaveRemote(ref, wasRole) {
    if (!ref || !user) return [];
    try {
      if (wasRole === 1) return [ref.update({ status: 'closed' })];
      if (wasRole === 2) return [ref.update({ guest: '', guestName: '' })];
    } catch (_) {}
    return [];
  }
  async function leaveRoom() {
    const ref = roomRef, wasRole = role;
    if (ref && roomListener) ref.off('value', roomListener);
    if (chatRef && chatListener) chatRef.off('child_added', chatListener);
    if (historyRef && historyListener) historyRef.off('value', historyListener);
    roomRef = null; roomListener = null; chatRef = null; historyRef = null; chatListener = null; historyListener = null; roomCode = null; role = 0; lastStateJson = '';
    savedHistoryKeys.clear();
    setRoomUI(false); setRoomTools(false); setRoomLabels('', '');
    if ($('chatMessages')) $('chatMessages').innerHTML = '<p class="empty-note">Tin nhắn sẽ hiện ở đây.</p>';
    if ($('matchHistory')) $('matchHistory').innerHTML = '<p class="empty-note">Chưa có trận đấu được lưu.</p>';
    window.dispatchEvent(new Event('online-left'));
    const tasks = leaveRemote(ref, wasRole);
    if (tasks.length) { try { await withTimeout(Promise.all(tasks), 2000); } catch (_) {} }
  }
  // Đóng/tải lại trang: cố gắng báo cho đối thủ biết (không chờ kết quả)
  window.addEventListener('pagehide', () => { leaveRemote(roomRef, role).forEach(quiet); });

  async function copyRoomCode() {
    if (!roomCode) return;
    try { await navigator.clipboard.writeText(roomCode); setRoomMessage(`Đã sao chép mã phòng ${roomCode}. Gửi mã này cho bạn bè.`); }
    catch (_) { setRoomMessage('Mã phòng của bạn: ' + roomCode); }
  }
  async function rematch() {
    if (!roomRef || !user) return setRoomMessage('Bạn cần ở trong phòng để chơi lại.', true);
    try {
      const data = (await withTimeout(roomRef.once('value'))).val();
      if (!data) return setRoomMessage('Phòng không còn tồn tại.', true);
      const old = canonState(data.state);
      if (old?.gameOver) await saveHistoryForState(old, data);
      await withTimeout(roomRef.child('state').set(initialState(data.game || currentGame, old)));
      setRoomMessage('Đã bắt đầu ván mới cho cả hai người chơi.');
    } catch (e) { setRoomMessage('Không thể bắt đầu lại: ' + dbError(e), true); }
  }

  $('createRoomBtn')?.addEventListener('click', createRoom);
  $('joinRoomBtn')?.addEventListener('click', joinRoom);
  document.querySelectorAll('#leaveRoomBtn, [data-leave-room]').forEach(b => b.addEventListener('click', () => { leaveRoom(); }));
  document.querySelectorAll('#copyRoomBtn, [data-copy-room]').forEach(b => b.addEventListener('click', copyRoomCode));
  document.querySelectorAll('#rematchBtn, [data-rematch]').forEach(b => b.addEventListener('click', rematch));
  $('chatToggle')?.addEventListener('click', toggleChat);
  $('chatForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const text = $('chatInput')?.value.trim();
    if (!text) return;
    if (!roomRef || !user) return showChatMessage('Hãy đăng nhập và vào phòng trước.', true);
    try {
      await withTimeout(roomRef.child('chat').push({ uid: user.uid, name: user.email || 'Người chơi', text: text.slice(0, 300), createdAt: firebase.database.ServerValue.TIMESTAMP }));
      $('chatInput').value = ''; showChatMessage('');
    } catch (e) { showChatMessage('Không gửi được tin nhắn: ' + dbError(e), true); }
  });

  window.addEventListener('online-publish', event => {
    if (!roomRef || !user || applyingRemote || role === 0) return;
    const state = canonState(event.detail); if (!state) return;
    const stateJson = JSON.stringify(state); if (stateJson === lastStateJson) return;
    lastStateJson = stateJson;
    roomRef.child('state').set(state).catch(e => setRoomMessage('Lỗi đồng bộ: ' + dbError(e), true));
  });
  window.OnlineGame = {
    getRole: () => role,
    isOnline: () => !!roomRef && role !== 0,
    canMove: player => !roomRef || (role === player),
    publish: state => window.dispatchEvent(new CustomEvent('online-publish', { detail: state })),
    isApplying: () => applyingRemote,
    currentGame: () => currentGame
  };
  initFirebase();
})();