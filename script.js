window.addEventListener('load', () => {

    // 使用する画像生成モデルのAPIエンドポイント
    // 変更後
    const IMAGE_GENERATION_API_URL = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0';
    
    // 翻訳APIのURL (これは変更不要)
    const TRANSLATE_API_URL = 'https://script.google.com/macros/s/AKfycbysDLQt1Di1iGqpJetaW_uEtW2tb0DqSoAq2sDWF-_gpSm8veAUPDtl9BWzaT-t6xOx/exec';

    let currentRoom = 'image';

    // --- HTML要素の取得 ---
    const sidebar = document.getElementById('sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const sendBtn = document.getElementById('send-btn');
    const promptInput = document.getElementById('prompt-input');
    const loadingDiv = document.getElementById('loading');
    const roomTitle = document.getElementById('room-title');
    const navButtons = document.querySelectorAll('.nav-btn');
    const homeBtn = document.getElementById('home-btn');
    const chatArea = document.getElementById('chat-area');
    const gameContainer = document.getElementById('game-container');
    const container = document.querySelector('.container'); // ★ 追加

    // --- イベントリスナーの設定 ---
    sidebarToggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        container.classList.toggle('sidebar-open'); // ★ 追加
    });

    homeBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
    });
    
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (button.disabled) return; // 無効化されたボタンは無視
            
            const newRoom = button.dataset.room;
            currentRoom = newRoom;

            // 全てのチャットパネルを隠す
            document.querySelectorAll('.chat-history-panel').forEach(panel => {
                panel.classList.remove('active-panel');
            });

            if (newRoom === 'game') {
                roomTitle.textContent = 'ミニゲーム';
                chatArea.classList.add('hidden');
                gameContainer.classList.remove('hidden');
                // game.jsの初期化関数を呼び出す
                if (typeof initializeGame === 'function') {
                    // ゲーム用のHTML構造を動的に読み込む
                    if (!document.getElementById('game-board')) {
                        fetch('game_content.html')
                            .then(response => response.text())
                            .then(html => {
                                gameContainer.innerHTML = html;
                                initializeGame();
                            });
                    } else {
                        initializeGame();
                    }
                }
            } else {
                gameContainer.classList.add('hidden');
                chatArea.classList.remove('hidden');
                
                const targetPanel = document.getElementById(`chat-history-${newRoom}`);
                if(targetPanel) targetPanel.classList.add('active-panel');

                // この簡易版では画像生成ルームのみ
                roomTitle.textContent = 'AI Image Generator';
                promptInput.placeholder = '作りたい画像の日本語プロンプトを入力';
            }
            
            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });

    sendBtn.addEventListener('click', async () => {
        const japanesePrompt = promptInput.value.trim();
        if (!japanesePrompt || currentRoom !== 'image') return;
        
        addUserMessage(japanesePrompt, currentRoom);
        loadingDiv.classList.remove('hidden');
        promptInput.value = '';
        sendBtn.disabled = true;

        try {
            addSystemMessage('日本語を英語に翻訳中...', currentRoom);
            const res = await fetch(`${TRANSLATE_API_URL}?text=${encodeURIComponent(japanesePrompt)}`);
            if (!res.ok) throw new Error('翻訳APIエラー');
            const data = await res.json();
            const englishPrompt = data.translated;
            addSystemMessage(`翻訳結果: ${englishPrompt}`, currentRoom);
            
            // 画像生成ハンドラを呼び出す
            await handleImageGeneration(englishPrompt, currentRoom);

        } catch (error) {
            addErrorMessage(error.message, currentRoom);
            loadingDiv.classList.add('hidden');
            sendBtn.disabled = false;
        }
    });

    promptInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });
    
    // --- 初期化処理 ---
    const params = new URLSearchParams(window.location.search);
    const initialRoom = params.get('room');
    if (initialRoom) {
        const targetButton = document.querySelector(`.nav-btn[data-room="${initialRoom}"]`);
        if (targetButton && !targetButton.disabled) {
            targetButton.click();
        }
    } else {
        document.getElementById('chat-history-image').classList.add('active-panel');
    }

    // --- ここから下に関数定義をまとめる ---

    function appendMessageToPanel(room, element) {
        const targetPanel = document.getElementById(`chat-history-${room}`);
        if (targetPanel) {
            targetPanel.appendChild(element);
            targetPanel.scrollTop = targetPanel.scrollHeight;
        }
    }

    function addUserMessage(text, room) {
        const userMessage = document.createElement('div');
        userMessage.classList.add('user-message');
        userMessage.textContent = text;
        appendMessageToPanel(room, userMessage);
    }

    function addImageMessage(url, room, fileName = 'generated.png') {
        const container = document.createElement('div');
        container.classList.add('image-container');
        const img = document.createElement('img');
        img.src = url;
        // img.onload = () => URL.revokeObjectURL(url); // ★ 修正: この行を削除します。これが不具合の主な原因でした。
        container.appendChild(img);
        
        const buttonGroup = document.createElement('div');
        buttonGroup.classList.add('button-group');
        
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '📋 コピー';
        copyBtn.onclick = () => handleCopyToClipboard(url);
        buttonGroup.appendChild(copyBtn);
        
        const downloadBtn = createDownloadButton(url, fileName);
        buttonGroup.appendChild(downloadBtn);
        
        container.appendChild(buttonGroup);
        appendMessageToPanel(room, container);
    }

    function addErrorMessage(text, room) {
        const errorMessage = document.createElement('p');
        errorMessage.classList.add('error-message');
        errorMessage.textContent = `エラーが発生しました: ${text}`;
        appendMessageToPanel(room, errorMessage);
    }

    function addSystemMessage(text, room) {
        const systemMessage = document.createElement('p');
        systemMessage.classList.add('system-message');
        systemMessage.textContent = text;
        appendMessageToPanel(room, systemMessage);
    }

    async function handleImageGeneration(prompt, room) {
        try {
            // 呼び出し先を、Hugging FaceのURLから自作のサーバーレス関数のパスに変更
            // /.netlify/functions/ はNetlify上の特別なパス
            addSystemMessage('サーバーレス関数経由で画像を生成します...', room);
            const response = await fetch('/.netlify/functions/generateImage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prompt: prompt }), // プロンプトをJSON形式で送信
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `APIエラー: ${response.status}`);
            }

            const blob = await response.blob();
            if (blob.type !== 'image/jpeg' && blob.type !== 'image/png') {
                throw new Error('APIから無効な形式のファイルが返されました。');
            }

            const imageUrl = URL.createObjectURL(blob);
            addImageMessage(imageUrl, room, `generated_${Date.now()}.png`);

        } catch (error) {
            addErrorMessage(error.message, room);
        } finally {
            loadingDiv.classList.add('hidden');
            sendBtn.disabled = false;
        }
    }

    function createDownloadButton(url, fileName) {
        const button = document.createElement('button');
        button.textContent = '⬇️';
        button.title = 'ダウンロード';
        button.onclick = () => handleDownload(url, fileName);
        return button;
    }

    // ★ 修正: handleDownload関数をシンプルで確実な実装に変更
    function handleDownload(url, fileName) {
        try {
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (error) {
            console.error('ダウンロードエラー:', error);
            addErrorMessage('ダウンロードに失敗しました。', currentRoom);
        }
    }

    async function handleCopyToClipboard(imageUrl) {
        try {
            // 1. 画像の元データ(Blob)を取得
            const blob = await fetch(imageUrl).then(res => res.blob());

            // 2. 画像をPNGに変換するための準備 (Canvasを使用)
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // 3. 画像データを読み込んでCanvasに描画
            const img = new Image();
            // Promiseを使って画像の読み込み完了を待つ
            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = (err) => reject(err);
                img.src = URL.createObjectURL(blob);
            });
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            // 4. Canvasの内容をPNG形式のBlobとして取得
            const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

            // 5. PNGに変換したデータをクリップボードに書き込む
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngBlob })
            ]);

            addSystemMessage('画像をクリップボードにコピーしました！', currentRoom);

        } catch (error) {
            console.error('コピー失敗:', error);
            addErrorMessage('クリップボードへのコピーに失敗しました。', currentRoom);
        }
    }
});