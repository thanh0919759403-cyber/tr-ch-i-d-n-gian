// ============================================================
// GAME DÂN GIAN - Ô ĂN QUAN + CỜ CARO 7x7
// 2 người chơi trên cùng thiết bị (chơi bằng chuột)
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // --------------------------------------------------------
    // CHUYỂN MÀN HÌNH
    // --------------------------------------------------------
    const menuScreen = document.getElementById('menuScreen');
    const oanQuanScreen = document.getElementById('oanQuanScreen');
    const caroScreen = document.getElementById('caroScreen');
    const bauCuaScreen = document.getElementById('bauCuaScreen');

    function showScreen(screen) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        screen.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // --------------------------------------------------------
    // CHẾ ĐỘ CHƠI: 'human' = 2 người cùng máy, 'bot' = chơi với máy
    // Bot luôn là Người chơi 2 (O trong Caro, 5 ô phía trên trong Ô Ăn Quan)
    // --------------------------------------------------------
    let playMode = 'human';
    let botLevel = 'medium';     // 'easy' | 'medium' | 'hard'
    let botActing = false;       // true khi chính bot đang đi (để bỏ qua khóa lượt)
    let caroBotTimer = null;
    let oBotTimer = null;

    const isBot = () => playMode === 'bot' && !window.OnlineGame?.isOnline();
    const pName = p => (p === 2 && isBot() ? 'Máy' : `Người chơi ${p}`);

    document.getElementById('openOanQuan')?.addEventListener('click', () => {
        syncModeFromUI();
        showScreen(oanQuanScreen);
        updateOUI();
        scheduleOBot();
    });

    document.getElementById('openCaro')?.addEventListener('click', () => {
        syncModeFromUI();
        showScreen(caroScreen);
        updateCaroUI();
        scheduleCaroBot();
    });

    document.getElementById('openBauCua')?.addEventListener('click', () => {
        showScreen(bauCuaScreen);
        bcRender();
    });

    document.querySelectorAll('[data-menu]').forEach(btn => {
        btn.addEventListener('click', () => showScreen(menuScreen));
    });

    // ========================================================
    // Ô ĂN QUAN
    // ========================================================
    //
    // LUẬT (luật gốc):
    // - Bàn 12 ô: 0 = Ô QUAN (bên trái), 1-5 = dân của người 1,
    //             6 = Ô QUAN (bên phải), 7-11 = dân của người 2.
    // - Mỗi ô dân bắt đầu với 5 quân dân.
    // - Mỗi ô QUAN có 1 quan, trị giá 10 điểm.
    // - Chọn 1 ô dân bên mình (có quân) + hướng, bốc hết và rải từng quân.
    // - Rải xong, nhìn ô kế tiếp:
    //     * Ô có quân dân  -> bốc lên rải tiếp.
    //     * Ô QUAN (còn quan) -> dừng lượt (mất lượt).
    //     * Ô trống        -> ăn ô liền sau nó nếu có quân.
    //                         Ăn xong, nếu ô kế tiếp lại trống và ô sau nữa
    //                         có quân thì ăn tiếp. Hai ô trống liền nhau -> dừng.
    // - Hết quân dân trên phần bàn của mình: lấy 5 quân đã ăn rải lại
    //   mỗi ô 1 quân (nếu thiếu thì ghi nợ, điểm có thể âm).
    // - Ván kết thúc khi cả 2 quan đã bị ăn. Quân dân còn lại về chủ phần bàn.
    // - Mỗi người chơi có 1 ô chứa quân đã ăn (quan + dân).

    const DAN_PER_PIT = 5;       // mỗi ô dân 5 quân
    const QUAN_VALUE = 10;       // 1 quan = 10 điểm
    const QUAN_MIN_DAN = 0;      // 0 = ô QUAN luôn ăn được. Đặt số > 0 để bật luật "quan non"
    const RESEED_COST = 5;       // hết quân: dùng 5 quân đã ăn rải lại mỗi ô 1 quân

    const QUAN_PITS = [0, 6];
    const P1_PITS = [1, 2, 3, 4, 5];
    const P2_PITS = [7, 8, 9, 10, 11];

    let oBoard;                  // số quân dân trong mỗi ô
    let quanAlive;               // quanAlive[0], quanAlive[6]
    let oTurnPlayer = 1;
    let selectedPit = null;
    let oGameOver = false;
    let oAnimating = false;

    // Quân đã ăn của mỗi người chơi (dan có thể âm = đang nợ)
    let captured = { 1: { dan: 0, quan: 0 }, 2: { dan: 0, quan: 0 } };
    const getScore = p => captured[p].dan + captured[p].quan * QUAN_VALUE;

    const oMessage = document.getElementById('oMessage');
    const oTurn = document.getElementById('oTurn');
    const p1ScoreEl = document.getElementById('p1Score');
    const p2ScoreEl = document.getElementById('p2Score');
    const directionPanel = document.getElementById('directionPanel');
    const sowStatus = document.getElementById('sowStatus');
    const sowText = document.getElementById('sowText');

    // --------------------------------------------------------
    // Ô CHỨA QUÂN ĐÃ ĂN (tự tạo nếu HTML chưa có #p1Captured / #p2Captured)
    // --------------------------------------------------------
    function ensureCaptureBox(id, anchorEl) {
        let box = document.getElementById(id);
        if (!box && anchorEl) {
            box = document.createElement('div');
            box.id = id;
            anchorEl.insertAdjacentElement('afterend', box);
        }
        if (box) {
            box.style.cssText =
                'display:flex;flex-wrap:wrap;align-items:center;gap:3px;' +
                'min-height:56px;padding:6px;margin-top:6px;' +
                'border:2px dashed #8b6b3a;border-radius:10px;background:rgba(255,255,255,.25);';
        }
        return box;
    }

    const p1CapturedEl = ensureCaptureBox('p1Captured', p1ScoreEl);
    const p2CapturedEl = ensureCaptureBox('p2Captured', p2ScoreEl);

    function renderCaptured(el, c) {
        if (!el) return;
        el.innerHTML = '';

        for (let i = 0; i < c.quan; i++) {
            const q = document.createElement('span');
            q.className = 'stone quan';
            q.style.background = '#d4a017';
            q.style.transform = 'scale(1.5)';
            q.style.margin = '4px';
            el.appendChild(q);
        }

        const danShow = Math.min(Math.max(c.dan, 0), 30);
        for (let i = 0; i < danShow; i++) {
            const s = document.createElement('span');
            s.className = 'stone';
            el.appendChild(s);
        }

        const label = document.createElement('small');
        label.style.marginLeft = '6px';
        label.textContent = `${c.quan} quan + ${c.dan} dân`;
        el.appendChild(label);
    }

    // --------------------------------------------------------
    // KHỞI TẠO / TIỆN ÍCH
    // --------------------------------------------------------
    function initOBoard() {
        oBoard = Array(12).fill(DAN_PER_PIT);
        oBoard[0] = 0;
        oBoard[6] = 0;
        quanAlive = { 0: true, 6: true };
    }
    initOBoard();

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const wrap = i => (i + 12) % 12;
    const isQuanPit = i => QUAN_PITS.includes(i);
    const hasQuan = i => isQuanPit(i) && quanAlive[i] === true;
    const pitHasStuff = i => oBoard[i] > 0 || hasQuan(i);
    const getOwnPits = player => (player === 1 ? P1_PITS : P2_PITS);
    const isOwnPit = (i, player) => getOwnPits(player).includes(i);
    const bothQuanGone = () => !quanAlive[0] && !quanAlive[6];
    const formatScore = s => `${s} điểm`;

    // Ô có thể bị ăn không?
    function canCapture(i) {
        if (hasQuan(i)) return oBoard[i] >= QUAN_MIN_DAN; // quan non thì chưa ăn được
        return oBoard[i] > 0;
    }

    function addCaptured(player, dan, quan) {
        captured[player].dan += dan;
        captured[player].quan += quan;
    }

    function setOMessage(message) {
        if (oMessage) oMessage.textContent = message;
        if (sowText) sowText.textContent = message;
    }

    function getPitName(index) {
        if (index === 0) return 'QUAN trái';
        if (index === 6) return 'QUAN phải';
        if (index >= 1 && index <= 5) return `Ô ${index}`;
        return `Ô ${index - 6}`;
    }

    function renderStones(index) {
        const stonesEl = document.getElementById(`pit${index}`);
        if (!stonesEl) return;
        stonesEl.innerHTML = '';

        if (hasQuan(index)) {
            const quan = document.createElement('span');
            quan.className = 'stone quan';
            // Hiển thị quan to và màu vàng, không cần sửa CSS
            quan.style.background = '#d4a017';
            quan.style.transform = 'scale(1.7)';
            quan.style.margin = '4px';
            stonesEl.appendChild(quan);
        }

        const visualCount = Math.min(oBoard[index], 20);
        for (let i = 0; i < visualCount; i++) {
            const stone = document.createElement('span');
            stone.className = 'stone';
            stonesEl.appendChild(stone);
        }
    }

    function updateOUI() {
        if (window.OnlineGame?.isOnline() && !window.OnlineGame.isApplying()) {
            window.OnlineGame.publish({ kind: 'oanquan', board: oBoard, quanAlive, turn: oTurnPlayer, captured, gameOver: oGameOver });
        }
        for (let i = 0; i < 12; i++) {
            const countEl = document.getElementById(`count${i}`);
            if (countEl) {
                countEl.textContent = hasQuan(i) ? `👑+${oBoard[i]}` : oBoard[i];
            }
            renderStones(i);
        }

        if (p1ScoreEl) p1ScoreEl.textContent = formatScore(getScore(1));
        if (p2ScoreEl) p2ScoreEl.textContent = formatScore(getScore(2));
        renderCaptured(p1CapturedEl, captured[1]);
        renderCaptured(p2CapturedEl, captured[2]);
        if (oTurn) oTurn.textContent = pName(oTurnPlayer);
        refreshModeLabels();

        document.querySelectorAll('.pit').forEach(pit => {
            const index = Number(pit.dataset.pit);
            pit.classList.remove('selected', 'disabled', 'available');

            if (oGameOver || oAnimating || isBotTurnO() || (window.OnlineGame?.isOnline() && !window.OnlineGame.canMove(oTurnPlayer))) {
                pit.classList.add('disabled');
                if (selectedPit === index) pit.classList.add('selected');
                return;
            }

            if (isOwnPit(index, oTurnPlayer) && oBoard[index] > 0) {
                pit.classList.add('available');
            } else {
                pit.classList.add('disabled');
            }

            if (selectedPit === index) pit.classList.add('selected');
        });

        directionPanel?.classList.toggle('show', selectedPit !== null && !oAnimating && !oGameOver && !isBotTurnO());
        sowStatus?.classList.toggle('running', oAnimating);
    }

    function selectOPit(index) {
        if (window.OnlineGame?.isOnline() && !window.OnlineGame.canMove(oTurnPlayer)) return;
        if (oGameOver || oAnimating) return;
        if (isBotTurnO() && !botActing) return; // lượt của máy, người chơi không được bấm
        if (!isOwnPit(index, oTurnPlayer)) return;
        if (oBoard[index] <= 0) return;

        selectedPit = index;
        setOMessage(`Đã chọn ${getPitName(index)}. Hãy chọn hướng rải.`);
        updateOUI();
    }

    function markSowing(index) {
        document.querySelectorAll('.pit').forEach(p => p.classList.remove('sowing'));
        document.querySelector(`.pit[data-pit="${index}"]`)?.classList.add('sowing');
    }

    function markReceived(index) {
        document.querySelectorAll('.pit').forEach(p => p.classList.remove('just-received'));
        document.querySelector(`.pit[data-pit="${index}"]`)?.classList.add('just-received');
    }

    function clearMarks() {
        document.querySelectorAll('.pit').forEach(p => p.classList.remove('sowing', 'just-received'));
    }

    // Quân dân còn lại về chủ phần bàn khi kết thúc
    function collectRemainingStones() {
        for (const i of P1_PITS) { captured[1].dan += oBoard[i]; oBoard[i] = 0; }
        for (const i of P2_PITS) { captured[2].dan += oBoard[i]; oBoard[i] = 0; }
        // Dân còn kẹt trong ô QUAN (đã mất quan) chia theo bên của ô
        captured[1].dan += oBoard[0]; oBoard[0] = 0;
        captured[2].dan += oBoard[6]; oBoard[6] = 0;
    }

    function finishOGame() {
        if (oGameOver) return;

        oGameOver = true;
        oAnimating = false;
        selectedPit = null;

        collectRemainingStones();
        updateOUI();

        const s1 = getScore(1);
        const s2 = getScore(2);

        let title, text;
        if (s1 === s2) {
            title = 'Hòa!';
            text = `Hai người cùng có ${s1} điểm.`;
        } else {
            const winner = s1 > s2 ? 1 : 2;
            title = `${pName(winner)} thắng!`;
            text = `${pName(1)}: ${s1} điểm — ${pName(2)}: ${s2} điểm.`;
        }
        text += ' Hai ô QUAN đã bị ăn hết.';

        showResultModal('🏆', title, text, 'oanquan');
        setOMessage('Ván đấu đã kết thúc.');
    }

    // Hết quân trên phần bàn của mình: lấy 5 quân đã ăn rải mỗi ô 1 quân
    function reseedIfNeeded(player) {
        const pits = getOwnPits(player);
        if (pits.some(i => oBoard[i] > 0)) return false;

        captured[player].dan -= RESEED_COST; // thiếu quân thì coi như ghi nợ
        pits.forEach(i => { oBoard[i] = 1; });
        return true;
    }

    function switchOTurn() {
        oTurnPlayer = oTurnPlayer === 1 ? 2 : 1;
        selectedPit = null;

        const reseeded = reseedIfNeeded(oTurnPlayer);
        updateOUI();

        if (reseeded) {
            setOMessage(`${pName(oTurnPlayer)} hết quân, dùng ${RESEED_COST} quân đã ăn rải lại mỗi ô 1 quân.`);
        } else if (isBotTurnO()) {
            setOMessage('Máy đang suy nghĩ...');
        } else {
            setOMessage(`Lượt của ${pName(oTurnPlayer)}. Chọn một ô có quân.`);
        }

        scheduleOBot();
    }

    // Bốc `count` quân trên tay và rải từng quân theo hướng dir, bắt đầu từ ô kế `from`.
    // Trả về ô cuối cùng nhận quân.
    async function sowStones(from, count, dir) {
        let current = from;
        let hand = count;

        while (hand > 0) {
            current = wrap(current + dir);
            markSowing(current);
            await sleep(300);

            oBoard[current] += 1;
            hand--;
            markReceived(current);
            updateOUI();
            setOMessage(`Đang rải: còn ${hand} quân.`);
            await sleep(200);
        }

        clearMarks();
        return current;
    }

    async function startOSow(dir) {
        if (window.OnlineGame?.isOnline() && !window.OnlineGame.canMove(oTurnPlayer)) return;
        if (oGameOver || oAnimating || selectedPit === null) return;
        if (isBotTurnO() && !botActing) return; // người chơi không được đi thay máy

        oAnimating = true;
        const player = oTurnPlayer;
        const startPit = selectedPit;
        selectedPit = null;

        let hand = oBoard[startPit];
        oBoard[startPit] = 0;
        updateOUI();
        setOMessage(`${pName(player)} đang rải quân...`);

        let current = await sowStones(startPit, hand, dir);

        // Vòng lặp chính: xét ô kế tiếp sau khi rải xong
        while (!oGameOver) {
            const next = wrap(current + dir);

            // Gặp ô QUAN còn quan -> mất lượt
            if (hasQuan(next)) {
                setOMessage(`Gặp ${getPitName(next)}, hết lượt.`);
                await sleep(500);
                break;
            }

            // Ô kế tiếp có dân -> bốc lên rải tiếp
            if (oBoard[next] > 0) {
                hand = oBoard[next];
                oBoard[next] = 0;
                updateOUI();
                setOMessage(`Bốc ${hand} quân ở ${getPitName(next)}, rải tiếp...`);
                await sleep(450);
                current = await sowStones(next, hand, dir);
                continue;
            }

            // Ô kế tiếp trống -> ăn ô liền sau nếu có thể, ăn liên tiếp
            let empty = next;
            while (true) {
                const target = wrap(empty + dir);
                if (!pitHasStuff(target) || !canCapture(target)) break;

                const danGained = oBoard[target];
                let quanGained = 0;
                if (hasQuan(target)) {
                    quanGained = 1;
                    quanAlive[target] = false;
                }
                oBoard[target] = 0;
                addCaptured(player, danGained, quanGained);

                const gained = danGained + quanGained * QUAN_VALUE;
                updateOUI();
                setOMessage(`${pName(player)} ăn ${getPitName(target)}: +${gained} điểm.`);
                await sleep(650);

                if (bothQuanGone()) break;

                // Ăn tiếp chỉ khi ô ngay sau ô vừa ăn cũng trống
                empty = wrap(target + dir);
                if (pitHasStuff(empty)) break;
            }
            break;
        }

        oAnimating = false;

        if (bothQuanGone()) {
            finishOGame();
            return;
        }

        switchOTurn();
    }

    document.querySelectorAll('.pit').forEach(pit => {
        pit.addEventListener('click', () => selectOPit(Number(pit.dataset.pit)));
    });

    // Trái = ngược chiều (-1), phải = xuôi chiều (+1)
    document.getElementById('leftBtn')?.addEventListener('click', () => startOSow(-1));
    document.getElementById('rightBtn')?.addEventListener('click', () => startOSow(1));

    function resetOanQuan() {
        clearTimeout(oBotTimer);
        initOBoard();
        captured = { 1: { dan: 0, quan: 0 }, 2: { dan: 0, quan: 0 } };
        oTurnPlayer = 1;
        selectedPit = null;
        oGameOver = false;
        oAnimating = false;

        closeResultModal();
        setOMessage('Chọn một ô có quân của bạn.');
        updateOUI();
    }

    document.getElementById('resetOanQuan')?.addEventListener('click', resetOanQuan);

    // ========================================================
    // CỜ CARO 7x7 - 5 QUÂN LIÊN TIẾP THẮNG
    // ========================================================

    const CARO_SIZE = 7;
    const CARO_WIN_LENGTH = 5;
    let caroBoard = Array(CARO_SIZE * CARO_SIZE).fill('');
    let caroPlayer = 'X';
    let caroGameOver = false;
    let xWins = 0;
    let oWins = 0;

    const caroBoardEl = document.getElementById('caroBoard');
    const caroStatus = document.getElementById('caroStatus');
    const xWinsEl = document.getElementById('xWins');
    const oWinsEl = document.getElementById('oWins');

    function buildCaroBoard() {
        if (!caroBoardEl) return;

        caroBoardEl.innerHTML = '';
        caroBoardEl.style.gridTemplateColumns = `repeat(${CARO_SIZE}, 1fr)`;
        caroBoardEl.style.gridTemplateRows = `repeat(${CARO_SIZE}, 1fr)`;

        for (let i = 0; i < CARO_SIZE * CARO_SIZE; i++) {
            const cell = document.createElement('button');
            cell.className = 'cell';
            cell.dataset.cell = i;
            cell.setAttribute('aria-label', `Ô ${i + 1}`);
            cell.addEventListener('click', () => playCaroCell(i));
            caroBoardEl.appendChild(cell);
        }
    }

    function getCaroCoordinates(index) {
        return { row: Math.floor(index / CARO_SIZE), col: index % CARO_SIZE };
    }

    function countDirection(row, col, rowStep, colStep, player) {
        let count = 0;
        let r = row + rowStep;
        let c = col + colStep;

        while (
            r >= 0 && r < CARO_SIZE &&
            c >= 0 && c < CARO_SIZE &&
            caroBoard[r * CARO_SIZE + c] === player
        ) {
            count++;
            r += rowStep;
            c += colStep;
        }

        return count;
    }

    function checkCaroWin(index, player) {
        const { row, col } = getCaroCoordinates(index);
        const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

        for (const [dr, dc] of directions) {
            const total =
                1 +
                countDirection(row, col, dr, dc, player) +
                countDirection(row, col, -dr, -dc, player);

            if (total >= CARO_WIN_LENGTH) return true;
        }

        return false;
    }

    function isCaroDraw() {
        return caroBoard.every(cell => cell !== '');
    }

    function highlightCaroWin(index, player) {
        const { row, col } = getCaroCoordinates(index);
        const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

        for (const [dr, dc] of directions) {
            const line = [index];

            for (const sign of [1, -1]) {
                let r = row + dr * sign;
                let c = col + dc * sign;

                while (
                    r >= 0 && r < CARO_SIZE &&
                    c >= 0 && c < CARO_SIZE &&
                    caroBoard[r * CARO_SIZE + c] === player
                ) {
                    line.push(r * CARO_SIZE + c);
                    r += dr * sign;
                    c += dc * sign;
                }
            }

            if (line.length >= CARO_WIN_LENGTH) {
                line.forEach(i => {
                    caroBoardEl.querySelector(`[data-cell="${i}"]`)?.classList.add('winning');
                });
                return;
            }
        }
    }

    function updateCaroUI() {
        if (window.OnlineGame?.isOnline() && !window.OnlineGame.isApplying()) {
            window.OnlineGame.publish({ kind: 'caro', board: caroBoard, turn: caroPlayer, gameOver: caroGameOver, xWins, oWins });
        }
        if (caroBoardEl) {
            caroBoardEl.querySelectorAll('.cell').forEach((cell, index) => {
                const value = caroBoard[index];
                cell.textContent = value;
                cell.classList.toggle('x', value === 'X');
                cell.classList.toggle('o', value === 'O');
                const localTurnBlocked = window.OnlineGame?.isOnline() && !window.OnlineGame.canMove(caroPlayer === 'X' ? 1 : 2);
                cell.disabled = caroGameOver || value !== '' || localTurnBlocked || isBotTurnCaro();
            });
        }

        refreshModeLabels();

        if (caroStatus) {
            if (caroGameOver) {
                caroStatus.textContent = 'Ván đấu đã kết thúc';
            } else if (isBotTurnCaro()) {
                caroStatus.textContent = `Máy đang suy nghĩ — ${caroPlayer}`;
            } else {
                const playerName = pName(caroPlayer === 'X' ? 1 : 2);
                caroStatus.textContent = `Lượt của ${playerName} — ${caroPlayer}`;
            }
        }

        if (xWinsEl) xWinsEl.textContent = `${xWins} thắng`;
        if (oWinsEl) oWinsEl.textContent = `${oWins} thắng`;
    }

    function playCaroCell(index) {
        if (window.OnlineGame?.isOnline() && !window.OnlineGame.canMove(caroPlayer === 'X' ? 1 : 2)) return;
        if (caroGameOver || caroBoard[index] !== '') return;
        if (isBotTurnCaro() && !botActing) return; // lượt của máy, người chơi không được bấm

        caroBoard[index] = caroPlayer;
        updateCaroUI();

        if (checkCaroWin(index, caroPlayer)) {
            caroGameOver = true;
            highlightCaroWin(index, caroPlayer);

            if (caroPlayer === 'X') xWins++;
            else oWins++;

            updateCaroUI();

            showResultModal(
                '🏆',
                `${pName(caroPlayer === 'X' ? 1 : 2)} thắng!`,
                `${caroPlayer} đã tạo được ${CARO_WIN_LENGTH} quân liên tiếp.`,
                'caro'
            );
            return;
        }

        if (isCaroDraw()) {
            caroGameOver = true;
            updateCaroUI();
            showResultModal('🤝', 'Hòa!', 'Bàn cờ đã kín nhưng không ai có 5 quân liên tiếp.', 'caro');
            return;
        }

        caroPlayer = caroPlayer === 'X' ? 'O' : 'X';
        updateCaroUI();
        scheduleCaroBot();
    }

    function resetCaro() {
        clearTimeout(caroBotTimer);
        caroBoard = Array(CARO_SIZE * CARO_SIZE).fill('');
        caroPlayer = 'X';
        caroGameOver = false;
        buildCaroBoard();
        updateCaroUI();
        closeResultModal();
    }

    document.getElementById('resetCaro')?.addEventListener('click', resetCaro);
    document.getElementById('newRound')?.addEventListener('click', resetCaro);

    // ========================================================
    // BOT (MÁY) CHƠI CÙNG - Cờ Caro + Ô Ăn Quan
    // Độ khó: easy (hay đi ngẫu nhiên), medium (tham lam), hard (nhìn trước nhiều nước)
    // ========================================================

    const randInt = n => Math.floor(Math.random() * n);
    const pickRandom = arr => arr[randInt(arr.length)];

    function isBotTurnCaro() { return isBot() && caroPlayer === 'O' && !caroGameOver; }
    function isBotTurnO() { return isBot() && oTurnPlayer === 2 && !oGameOver; }

    function refreshModeLabels() {
        const p2Name = document.querySelector('#p2Panel strong');
        if (p2Name) p2Name.textContent = isBot() ? 'Máy (Bot)' : 'Người chơi 2';
        const oCardLabel = document.querySelector('.o-card small');
        if (oCardLabel) oCardLabel.textContent = isBot() ? 'MÁY (BOT)' : 'NGƯỜI CHƠI 2';
    }

    // ---------------- BOT CỜ CARO ----------------
    // Mọi "cửa sổ" 5 ô liên tiếp trên bàn: dùng để chấm điểm thế cờ
    const CARO_WINDOWS = [];
    (() => {
        const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
        for (let r = 0; r < CARO_SIZE; r++) {
            for (let c = 0; c < CARO_SIZE; c++) {
                for (const [dr, dc] of dirs) {
                    const er = r + dr * (CARO_WIN_LENGTH - 1);
                    const ec = c + dc * (CARO_WIN_LENGTH - 1);
                    if (er < 0 || er >= CARO_SIZE || ec < 0 || ec >= CARO_SIZE) continue;
                    const w = [];
                    for (let k = 0; k < CARO_WIN_LENGTH; k++) w.push((r + dr * k) * CARO_SIZE + (c + dc * k));
                    CARO_WINDOWS.push(w);
                }
            }
        }
    })();
    const WINDOWS_BY_CELL = Array.from({ length: CARO_SIZE * CARO_SIZE }, () => []);
    CARO_WINDOWS.forEach(w => w.forEach(i => WINDOWS_BY_CELL[i].push(w)));
    const LINE_WEIGHT = [0, 1, 10, 100, 1000, 100000];

    function caroWinnerOf(board) {
        for (const w of CARO_WINDOWS) {
            const first = board[w[0]];
            if (first && w.every(i => board[i] === first)) return first;
        }
        return null;
    }

    function evalLines(board, player) {
        let total = 0;
        for (const w of CARO_WINDOWS) {
            let own = 0, blocked = false;
            for (const i of w) {
                const v = board[i];
                if (v === player) own++;
                else if (v !== '') { blocked = true; break; }
            }
            if (!blocked) total += LINE_WEIGHT[own];
        }
        return total;
    }

    // Điểm của một ô trống: tấn công (me) + phòng thủ (other)
    function cellScore(board, index, me, other) {
        let s = 0;
        for (const w of WINDOWS_BY_CELL[index]) {
            let mine = 0, theirs = 0;
            for (const j of w) {
                const v = board[j];
                if (v === me) mine++;
                else if (v === other) theirs++;
            }
            if (theirs === 0) s += LINE_WEIGHT[mine + 1];
            if (mine === 0) s += LINE_WEIGHT[theirs + 1] * 0.9;
        }
        return s;
    }

    const emptyCells = board => {
        const list = [];
        board.forEach((v, i) => { if (v === '') list.push(i); });
        return list;
    };

    function hasNeighbor(board, index) {
        const r = Math.floor(index / CARO_SIZE), c = index % CARO_SIZE;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nr = r + dr, nc = c + dc;
                if ((dr || dc) && nr >= 0 && nr < CARO_SIZE && nc >= 0 && nc < CARO_SIZE && board[nr * CARO_SIZE + nc] !== '') return true;
            }
        }
        return false;
    }

    function caroHeuristicMove(board, empties) {
        let best = empties[0], bestScore = -Infinity;
        for (const i of empties) {
            const s = cellScore(board, i, 'O', 'X') + Math.random() * 0.5;
            if (s > bestScore) { bestScore = s; best = i; }
        }
        return best;
    }

    function caroSearch(board, depth, alpha, beta, maxTurn) {
        const winner = caroWinnerOf(board);
        if (winner === 'O') return 1e6 + depth;
        if (winner === 'X') return -1e6 - depth;
        const empties = emptyCells(board);
        if (!empties.length) return 0;
        if (depth === 0) return evalLines(board, 'O') - evalLines(board, 'X') * 1.1;

        const me = maxTurn ? 'O' : 'X';
        const other = maxTurn ? 'X' : 'O';
        const cands = empties
            .map(i => ({ i, s: cellScore(board, i, me, other) }))
            .sort((a, b) => b.s - a.s)
            .slice(0, 8);

        if (maxTurn) {
            let best = -Infinity;
            for (const { i } of cands) {
                board[i] = 'O';
                best = Math.max(best, caroSearch(board, depth - 1, alpha, beta, false));
                board[i] = '';
                alpha = Math.max(alpha, best);
                if (alpha >= beta) break;
            }
            return best;
        }
        let best = Infinity;
        for (const { i } of cands) {
            board[i] = 'X';
            best = Math.min(best, caroSearch(board, depth - 1, alpha, beta, true));
            board[i] = '';
            beta = Math.min(beta, best);
            if (alpha >= beta) break;
        }
        return best;
    }

    function caroMinimaxMove(board, empties) {
        const cands = empties
            .map(i => ({ i, s: cellScore(board, i, 'O', 'X') }))
            .sort((a, b) => b.s - a.s)
            .slice(0, 10);
        const work = board.slice();
        let best = cands[0].i, bestScore = -Infinity;
        for (const { i } of cands) {
            work[i] = 'O';
            const score = caroSearch(work, 2, -Infinity, Infinity, false) + Math.random() * 0.5;
            work[i] = '';
            if (score > bestScore) { bestScore = score; best = i; }
        }
        return best;
    }

    function chooseCaroMove() {
        const empties = emptyCells(caroBoard);
        if (!empties.length) return -1;

        if (botLevel === 'easy') {
            if (Math.random() < 0.55) {
                const near = empties.filter(i => hasNeighbor(caroBoard, i));
                return pickRandom(near.length ? near : empties);
            }
            return caroHeuristicMove(caroBoard, empties);
        }
        if (botLevel === 'medium') return caroHeuristicMove(caroBoard, empties);
        return caroMinimaxMove(caroBoard, empties);
    }

    function scheduleCaroBot() {
        clearTimeout(caroBotTimer);
        if (!isBotTurnCaro() || !caroScreen.classList.contains('active')) return;
        caroBotTimer = setTimeout(botCaroMove, 450 + randInt(400));
    }

    function botCaroMove() {
        if (!isBotTurnCaro()) return;
        const index = chooseCaroMove();
        if (index < 0) return;
        botActing = true;
        try { playCaroCell(index); } finally { botActing = false; }
    }

    // ---------------- BOT Ô ĂN QUAN ----------------
    // Mô phỏng một nước đi (giống luật thật) mà không đụng tới bàn cờ đang chơi
    function simMove(board, qa, pit, dir) {
        const b = board.slice();
        const q = { 0: qa[0], 6: qa[6] };
        const hasQ = i => isQuanPit(i) && q[i] === true;
        const stuff = i => b[i] > 0 || hasQ(i);
        const sow = (from, n) => {
            let c = from;
            while (n > 0) { c = wrap(c + dir); b[c] += 1; n--; }
            return c;
        };

        let gain = 0;
        let hand = b[pit];
        b[pit] = 0;
        let current = sow(pit, hand);

        for (let guard = 0; guard < 200; guard++) {
            const next = wrap(current + dir);
            if (hasQ(next)) break;
            if (b[next] > 0) {
                hand = b[next];
                b[next] = 0;
                current = sow(next, hand);
                continue;
            }
            let empty = next;
            while (true) {
                const target = wrap(empty + dir);
                if (!stuff(target)) break;
                if (hasQ(target) && b[target] < QUAN_MIN_DAN) break;
                gain += b[target];
                b[target] = 0;
                if (hasQ(target)) { gain += QUAN_VALUE; q[target] = false; }
                if (!q[0] && !q[6]) break;
                empty = wrap(target + dir);
                if (stuff(empty)) break;
            }
            break;
        }

        return { board: b, qa: q, gain, over: !q[0] && !q[6] };
    }

    function listOMoves(board, player) {
        const moves = [];
        for (const pit of getOwnPits(player)) {
            if (board[pit] > 0) {
                moves.push({ pit, dir: -1 });
                moves.push({ pit, dir: 1 });
            }
        }
        return moves;
    }

    function chooseOMove() {
        const moves = listOMoves(oBoard, 2);
        if (!moves.length) return null;
        if (botLevel === 'easy') return pickRandom(moves);

        let best = moves[0], bestScore = -Infinity;
        for (const m of moves) {
            const result = simMove(oBoard, quanAlive, m.pit, m.dir);
            let score = result.gain;

            // Mức khó: trừ đi điểm tốt nhất mà đối thủ có thể ăn lại ở nước sau
            if (botLevel === 'hard' && !result.over) {
                let worst = 0;
                for (const om of listOMoves(result.board, 1)) {
                    worst = Math.max(worst, simMove(result.board, result.qa, om.pit, om.dir).gain);
                }
                score -= worst;
            }

            score += Math.random() * 0.5;
            if (score > bestScore) { bestScore = score; best = m; }
        }
        return best;
    }

    function scheduleOBot() {
        clearTimeout(oBotTimer);
        if (!isBotTurnO() || oAnimating || !oanQuanScreen.classList.contains('active')) return;
        oBotTimer = setTimeout(botOanQuanMove, 700);
    }

    async function botOanQuanMove() {
        if (!isBotTurnO() || oAnimating) return;
        const move = chooseOMove();
        if (!move) return;

        botActing = true;
        try {
            selectedPit = move.pit;
            setOMessage(`Máy chọn ${getPitName(move.pit)}, rải ${move.dir === -1 ? 'sang trái' : 'sang phải'}.`);
            updateOUI();
            await sleep(700);
            if (!isBotTurnO() || selectedPit !== move.pit) return;
            await startOSow(move.dir);
        } finally {
            botActing = false;
        }
    }

    // ---------------- CHỌN CHẾ ĐỘ ----------------
    const playModeEl = document.getElementById('playMode');
    const botLevelEl = document.getElementById('botLevel');
    const modeMessageEl = document.getElementById('modeMessage');
    const LEVEL_NAMES = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };

    function describeMode() {
        if (!modeMessageEl) return;
        modeMessageEl.textContent = playMode === 'bot'
            ? `Bạn là Người chơi 1 (đi trước), máy là Người chơi 2. Độ khó: ${LEVEL_NAMES[botLevel]}.`
            : 'Đang chơi 2 người cùng máy.';
    }

    playModeEl?.addEventListener('change', () => {
        if (window.OnlineGame?.isOnline()) {
            playModeEl.value = playMode;
            if (modeMessageEl) modeMessageEl.textContent = 'Đang ở trong phòng online. Hãy rời phòng rồi đổi chế độ.';
            return;
        }
        playMode = playModeEl.value;
        botLevelEl?.classList.toggle('hidden', playMode !== 'bot');
        resetOanQuan();
        resetCaro();
        describeMode();
    });

    botLevelEl?.addEventListener('change', () => {
        botLevel = botLevelEl.value;
        describeMode();
    });

    // Trình duyệt có thể nhớ lại giá trị ô chọn sau khi tải lại trang. Luôn đồng bộ
    // chế độ trong code theo đúng thứ đang hiển thị để không bị lệch (hiện "với máy"
    // nhưng thực tế vẫn là 2 người).
    function syncModeFromUI() {
        if (playModeEl) playMode = playModeEl.value === 'bot' ? 'bot' : 'human';
        if (botLevelEl) botLevel = LEVEL_NAMES[botLevelEl.value] ? botLevelEl.value : 'medium';
        botLevelEl?.classList.toggle('hidden', playMode !== 'bot');
        describeMode();
    }

    // ========================================================
    // BẦU CUA TÔM CÁ
    // - Lắc 3 xúc xắc, mỗi mặt là 1 trong 6 con.
    // - Cược vào con nào: mỗi xúc xắc ra con đó thì lời thêm đúng số tiền cược
    //   (ra 1 = lời 1 lần, ra 2 = lời 2 lần, ra 3 = lời 3 lần) và lấy lại tiền cược.
    // - Con không ra thì mất tiền cược. Tiền (xu ảo) được lưu lại trên trình duyệt.
    // ========================================================

    const BC_SYMBOLS = [
        { id: 'bau', name: 'Bầu', icon: '🥒' },
        { id: 'cua', name: 'Cua', icon: '🦀' },
        { id: 'tom', name: 'Tôm', icon: '🦐' },
        { id: 'ca',  name: 'Cá',  icon: '🐟' },
        { id: 'ga',  name: 'Gà',  icon: '🐓' },
        { id: 'nai', name: 'Nai', icon: '🦌' }
    ];
    const BC_START_COINS = 1000;
    const BC_MIN_CHIP = 10;
    const BC_STORAGE_KEY = 'gameDanGian.bauCuaCoins';

    function bcLoadCoins() {
        try {
            const saved = Number(localStorage.getItem(BC_STORAGE_KEY));
            if (Number.isFinite(saved) && saved >= BC_MIN_CHIP) return Math.floor(saved);
        } catch (_) { /* trình duyệt chặn lưu trữ: bỏ qua */ }
        return BC_START_COINS;
    }

    function bcSaveCoins() {
        try { localStorage.setItem(BC_STORAGE_KEY, String(bcCoins)); } catch (_) { /* bỏ qua */ }
    }

    let bcCoins = bcLoadCoins();
    let bcBets = {};             // { idCon: số xu đã cược }
    let bcChip = 10;
    let bcRolling = false;
    let bcHistory = [];          // mỗi phần tử: { icons: '🦀🐟🐟', net: số xu lời/lỗ }

    const bcBoardEl = document.getElementById('bcBoard');
    const bcCoinsEl = document.getElementById('bcCoins');
    const bcTotalEl = document.getElementById('bcTotalBet');
    const bcTitleEl = document.getElementById('bcResultTitle');
    const bcMessageEl = document.getElementById('bcMessage');
    const bcHistoryEl = document.getElementById('bcHistory');
    const bcRollBtn = document.getElementById('bcRoll');
    const bcClearBtn = document.getElementById('bcClear');
    const bcDiceEls = [0, 1, 2].map(i => document.getElementById(`bcDie${i}`));
    const bcChipEls = Array.from(document.querySelectorAll('.bc-chip'));
    const bcTiles = {};          // { idCon: { btn, bet, badge } }

    const bcTotal = () => Object.values(bcBets).reduce((sum, v) => sum + v, 0);
    const bcFormat = n => `${n} xu`;

    function setBcText(title, message) {
        if (bcTitleEl && title !== null) bcTitleEl.textContent = title;
        if (bcMessageEl && message !== null) bcMessageEl.textContent = message;
    }

    function buildBauCuaBoard() {
        if (!bcBoardEl) return;
        bcBoardEl.innerHTML = '';

        BC_SYMBOLS.forEach(symbol => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bc-tile';
            btn.setAttribute('aria-label', `Cược ${symbol.name}`);

            const badge = document.createElement('span');
            badge.className = 'bc-badge';
            const icon = document.createElement('span');
            icon.className = 'bc-icon';
            icon.textContent = symbol.icon;
            const name = document.createElement('span');
            name.className = 'bc-name';
            name.textContent = symbol.name;
            const bet = document.createElement('span');
            bet.className = 'bc-bet';
            bet.textContent = '0';

            btn.append(badge, icon, name, bet);
            btn.addEventListener('click', () => bcPlaceBet(symbol.id));
            bcBoardEl.appendChild(btn);
            bcTiles[symbol.id] = { btn, bet, badge };
        });
    }

    function bcClearMarks() {
        BC_SYMBOLS.forEach(s => {
            const tile = bcTiles[s.id];
            if (!tile) return;
            tile.btn.classList.remove('hit', 'miss');
            tile.badge.textContent = '';
        });
    }

    function bcRenderHistory() {
        if (!bcHistoryEl) return;
        bcHistoryEl.innerHTML = '';
        if (!bcHistory.length) {
            const note = document.createElement('p');
            note.className = 'empty-note';
            note.textContent = 'Chưa có ván nào.';
            bcHistoryEl.appendChild(note);
            return;
        }
        bcHistory.forEach(item => {
            const row = document.createElement('div');
            row.className = 'bc-history-row';
            const icons = document.createElement('span');
            icons.textContent = item.icons;
            const net = document.createElement('span');
            net.className = 'bc-net ' + (item.net > 0 ? 'win' : item.net < 0 ? 'lose' : '');
            net.textContent = item.net > 0 ? `+${item.net} xu` : item.net < 0 ? `${item.net} xu` : 'Hòa vốn';
            row.append(icons, net);
            bcHistoryEl.appendChild(row);
        });
    }

    function bcRender() {
        if (bcCoinsEl) bcCoinsEl.textContent = bcFormat(bcCoins);
        if (bcTotalEl) bcTotalEl.textContent = bcFormat(bcTotal());

        BC_SYMBOLS.forEach(s => {
            const tile = bcTiles[s.id];
            if (!tile) return;
            const amount = bcBets[s.id] || 0;
            tile.bet.textContent = String(amount);
            tile.btn.classList.toggle('has-bet', amount > 0);
            tile.btn.disabled = bcRolling;
        });

        bcChipEls.forEach(chip => {
            chip.classList.toggle('active', Number(chip.dataset.chip) === bcChip);
            chip.disabled = bcRolling;
        });

        if (bcRollBtn) bcRollBtn.disabled = bcRolling || bcTotal() <= 0;
        if (bcClearBtn) bcClearBtn.disabled = bcRolling || bcTotal() <= 0;
    }

    function bcPlaceBet(id) {
        if (bcRolling) return;
        if (bcCoins < bcChip) {
            setBcText(null, `Bạn chỉ còn ${bcFormat(bcCoins)}, hãy chọn mệnh giá nhỏ hơn.`);
            return;
        }
        bcClearMarks();
        bcCoins -= bcChip;
        bcBets[id] = (bcBets[id] || 0) + bcChip;
        bcSaveCoins();
        setBcText('Đang đặt cược', `Đã cược ${bcFormat(bcTotal())}. Bấm "Lắc xúc xắc" khi sẵn sàng.`);
        bcRender();
    }

    function bcClearBets() {
        if (bcRolling) return;
        bcCoins += bcTotal();
        bcBets = {};
        bcSaveCoins();
        setBcText('Đã xóa cược', 'Tiền cược đã được trả lại.');
        bcRender();
    }

    async function bcRoll() {
        if (bcRolling) return;
        const staked = bcTotal();
        if (staked <= 0) {
            setBcText(null, 'Hãy đặt cược vào ít nhất 1 ô trước khi lắc.');
            return;
        }

        bcRolling = true;
        bcClearMarks();
        bcRender();
        setBcText('Đang lắc...', 'Hồi hộp quá!');
        bcDiceEls.forEach(d => d?.classList.add('rolling'));

        const shuffle = setInterval(() => {
            bcDiceEls.forEach(d => { if (d) d.textContent = pickRandom(BC_SYMBOLS).icon; });
        }, 90);
        await sleep(1200);
        clearInterval(shuffle);

        // Kết quả cuối cùng của 3 xúc xắc
        const result = [0, 1, 2].map(() => pickRandom(BC_SYMBOLS));
        bcDiceEls.forEach((d, i) => {
            if (!d) return;
            d.classList.remove('rolling');
            d.textContent = result[i].icon;
        });

        const counts = {};
        result.forEach(s => { counts[s.id] = (counts[s.id] || 0) + 1; });

        // Tính tiền: con nào ra m lần và có cược b thì nhận lại b + b*m
        let returned = 0;
        BC_SYMBOLS.forEach(s => {
            const bet = bcBets[s.id] || 0;
            const times = counts[s.id] || 0;
            const tile = bcTiles[s.id];
            if (times > 0) {
                tile?.btn.classList.add('hit');
                if (tile) tile.badge.textContent = `×${times}`;
                if (bet > 0) returned += bet * (1 + times);
            } else if (bet > 0) {
                tile?.btn.classList.add('miss');
            }
        });

        const net = returned - staked;
        bcCoins += returned;
        bcBets = {};
        bcRolling = false;
        bcSaveCoins();

        const icons = result.map(s => s.icon).join(' ');
        const names = result.map(s => s.name).join(' - ');
        if (net > 0) setBcText(`Thắng +${net} xu 🎉`, `Kết quả: ${names}`);
        else if (net < 0) setBcText(`Thua ${-net} xu`, `Kết quả: ${names}`);
        else setBcText('Hòa vốn', `Kết quả: ${names}`);

        bcHistory.unshift({ icons, net });
        bcHistory = bcHistory.slice(0, 8);
        bcRenderHistory();
        bcRender();

        if (bcCoins < BC_MIN_CHIP) {
            showResultModal('💸', 'Hết tiền rồi!', `Bạn không còn đủ xu để cược. Chơi lại để nhận ${BC_START_COINS} xu mới.`, 'baucua');
        }
    }

    function resetBauCua() {
        bcCoins = BC_START_COINS;
        bcBets = {};
        bcChip = 10;
        bcRolling = false;
        bcHistory = [];
        bcSaveCoins();
        bcClearMarks();
        bcDiceEls.forEach(d => { if (d) { d.classList.remove('rolling'); d.textContent = '🎲'; } });
        setBcText('Đặt cược rồi lắc nhé!', 'Chọn mệnh giá, bấm vào ô để đặt cược.');
        bcRenderHistory();
        bcRender();
        closeResultModal();
    }

    bcChipEls.forEach(chip => {
        chip.addEventListener('click', () => {
            if (bcRolling) return;
            bcChip = Number(chip.dataset.chip) || 10;
            bcRender();
        });
    });
    bcRollBtn?.addEventListener('click', bcRoll);
    bcClearBtn?.addEventListener('click', bcClearBets);
    document.getElementById('resetBauCua')?.addEventListener('click', resetBauCua);

    // ========================================================
    // MODAL KẾT QUẢ
    // ========================================================

    const resultModal = document.getElementById('resultModal');
    const modalIcon = document.getElementById('modalIcon');
    const modalTitle = document.getElementById('modalTitle');
    const modalText = document.getElementById('modalText');
    const modalRestart = document.getElementById('modalRestart');
    const modalMenu = document.getElementById('modalMenu');
    let modalGame = null;

    function showResultModal(icon, title, text, game) {
        modalGame = game;
        if (modalIcon) modalIcon.textContent = icon;
        if (modalTitle) modalTitle.textContent = title;
        if (modalText) modalText.textContent = text;
        resultModal?.classList.remove('hidden');
    }

    function closeResultModal() {
        resultModal?.classList.add('hidden');
        modalGame = null;
    }

    modalRestart?.addEventListener('click', () => {
        if (modalGame === 'oanquan') resetOanQuan();
        else if (modalGame === 'caro') resetCaro();
        else if (modalGame === 'baucua') resetBauCua();
        else closeResultModal();
    });

    modalMenu?.addEventListener('click', () => {
        closeResultModal();
        showScreen(menuScreen);
    });

    // --------------------------------------------------------
    // ĐỒNG BỘ TRẠNG THÁI ONLINE TỪ PHÒNG FIREBASE
    // --------------------------------------------------------
    window.addEventListener('online-state', event => {
        const { game, state, role } = event.detail || {};
        if (!state) return;
        if (game === 'caro' && state.kind === 'caro') {
            const wasOver = caroGameOver;
            caroBoard = Array.isArray(state.board) ? state.board.slice() : Array(49).fill('');
            caroPlayer = state.turn || 'X'; caroGameOver = !!state.gameOver;
            xWins = state.xWins || 0; oWins = state.oWins || 0;
            buildCaroBoard(); updateCaroUI();
            if (!caroGameOver) {
                closeResultModal(); // đối thủ vừa bấm chơi lại / ván mới
            } else {
                let winnerMark = '', winnerIndex = -1;
                caroBoard.forEach((v, i) => { if (!winnerMark && v && checkCaroWin(i, v)) { winnerMark = v; winnerIndex = i; } });
                if (winnerMark) highlightCaroWin(winnerIndex, winnerMark);
                if (!wasOver) {
                    const winnerNo = winnerMark === 'X' ? 1 : 2;
                    if (!winnerMark) {
                        showResultModal('🤝', 'Hòa!', 'Bàn cờ đã kín nhưng không ai có 5 quân liên tiếp.', 'caro');
                    } else {
                        const iWon = winnerNo === role;
                        showResultModal(iWon ? '🏆' : '😅', iWon ? 'Bạn thắng!' : 'Đối thủ thắng!', `${winnerMark} đã tạo được ${CARO_WIN_LENGTH} quân liên tiếp.`, 'caro');
                    }
                }
            }
        } else if (game === 'oanquan' && state.kind === 'oanquan') {
            const wasOver = oGameOver;
            oBoard = Array.isArray(state.board) ? state.board.slice() : oBoard;
            quanAlive = state.quanAlive || quanAlive; oTurnPlayer = state.turn || 1;
            captured = state.captured || captured; oGameOver = !!state.gameOver;
            selectedPit = null; oAnimating = false; updateOUI();
            if (!oGameOver) {
                closeResultModal(); // đối thủ vừa bấm chơi lại
            } else if (!wasOver) {
                const s1 = getScore(1), s2 = getScore(2);
                const winner = s1 === s2 ? 0 : (s1 > s2 ? 1 : 2);
                const text = `Người chơi 1: ${s1} điểm — Người chơi 2: ${s2} điểm. Hai ô QUAN đã bị ăn hết.`;
                if (!winner) showResultModal('🤝', 'Hòa!', text, 'oanquan');
                else showResultModal(winner === role ? '🏆' : '😅', winner === role ? 'Bạn thắng!' : 'Đối thủ thắng!', text, 'oanquan');
                setOMessage('Ván đấu đã kết thúc.');
            }
        }
        document.body.dataset.onlineRole = String(role || 0);
        document.querySelectorAll('.cell, .pit, #leftBtn, #rightBtn').forEach(el => {
            el.title = 'Chỉ người đang đến lượt mới có thể đi.';
        });
    });
    // Rời phòng: bỏ ván online dở dang, quay lại ván mới để chơi trên máy
    window.addEventListener('online-left', () => {
        delete document.body.dataset.onlineRole;
        document.querySelectorAll('.cell, .pit, #leftBtn, #rightBtn').forEach(el => el.removeAttribute('title'));
        resetCaro();
        resetOanQuan();
    });

    // --------------------------------------------------------
    // KHỞI TẠO
    // --------------------------------------------------------
    syncModeFromUI();
    buildCaroBoard();
    updateOUI();
    updateCaroUI();
    buildBauCuaBoard();
    bcRenderHistory();
    bcRender();
});