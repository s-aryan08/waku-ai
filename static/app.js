/**
 * Waku AI - Companion Frontend Logic
 *
 * Features:
 * - Real-time AI response streaming
 * - Gemini-powered chat interface
 * - Speech synthesis
 * - Character lip-sync animation
 * - Hindi and English voice selection
 * - Immediate frontend cancellation
 * - Backend generation cancellation request
 * - Responsive chat alignment
 */

document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // 1. SESSION & DOM ELEMENTS
    // ==========================================

    const sessionId =
        'waku_session_' + Math.random().toString(36).substring(2, 12);

    const chatMessages = document.getElementById('chat-messages');
    const textInput = document.getElementById('text-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');
    const characterImage = document.getElementById('character-image');
    const voiceSelect = document.getElementById('voice-select');

    if (
        !chatMessages ||
        !textInput ||
        !sendButton ||
        !stopButton ||
        !characterImage ||
        !voiceSelect
    ) {
        console.error('Waku AI: Required HTML elements are missing.');
        return;
    }

    // ==========================================
    // 2. CHARACTER IMAGES
    // ==========================================

    const openMouthImg =
        `/static/images/char-mouth-open.png?v=${sessionId}`;

    const closedMouthImg =
        `/static/images/char-mouth-closed.png?v=${sessionId}`;

    characterImage.src = closedMouthImg;

    const preloadOpen = new Image();
    preloadOpen.src = openMouthImg;

    const preloadClosed = new Image();
    preloadClosed.src = closedMouthImg;

    // ==========================================
    // 3. GLOBAL STATE
    // ==========================================

    let voices = [];

    let lipSyncInterval = null;

    let currentAbortController = null;

    let currentReader = null;

    let isGenerating = false;

    let generationId = 0;

    // ==========================================
    // 4. VOICE SELECTION
    // ==========================================

    function populateVoiceList() {

        if (!('speechSynthesis' in window)) {
            voiceSelect.style.display = 'none';
            return;
        }

        const allVoices = window.speechSynthesis.getVoices();

        if (!allVoices || allVoices.length === 0) {
            return;
        }

        const previousVoice = voiceSelect.value;

        voices = allVoices;

        voiceSelect.innerHTML = '';

        let selectedIndex = 0;

        voices.forEach((voice, index) => {

            const option = document.createElement('option');

            option.textContent = `${voice.name} (${voice.lang})`;

            option.value = voice.name;

            voiceSelect.appendChild(option);

            if (
                voice.lang === 'en-US' &&
                selectedIndex === 0
            ) {
                selectedIndex = index;
            }

        });

        // Preserve previously selected voice when available.

        const previousIndex = voices.findIndex(
            voice => voice.name === previousVoice
        );

        voiceSelect.selectedIndex =
            previousIndex >= 0 ? previousIndex : selectedIndex;
    }

    populateVoiceList();

    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = populateVoiceList;
    }

    // ==========================================
    // 5. CHAT MESSAGE CREATION
    // ==========================================

    function appendMessage(role, text = '') {

        const row = document.createElement('div');

        row.className =
            `message-row ${role === 'user' ? 'user-row' : 'waku-row'}`;

        const bubble = document.createElement('div');

        bubble.className =
            `message-bubble ${role === 'user' ? 'user-bubble' : 'waku-bubble'}`;

        bubble.textContent = text;

        row.appendChild(bubble);

        chatMessages.appendChild(row);

        chatMessages.scrollTop = chatMessages.scrollHeight;

        return bubble;
    }

    // ==========================================
    // 6. TYPING INDICATOR
    // ==========================================

    function showTypingIndicator() {

        removeTypingIndicator();

        const row = document.createElement('div');

        row.className = 'message-row waku-row typing-row';

        row.id = 'typing-indicator';

        const bubble = document.createElement('div');

        bubble.className =
            'message-bubble waku-bubble typing-bubble';

        bubble.innerHTML = `
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
        `;

        row.appendChild(bubble);

        chatMessages.appendChild(row);

        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function removeTypingIndicator() {

        const indicator =
            document.getElementById('typing-indicator');

        if (indicator) {
            indicator.remove();
        }
    }

    // ==========================================
    // 7. SPEECH SYNTHESIS
    // ==========================================

    function speak(text) {

        if (
            !('speechSynthesis' in window) ||
            !text ||
            isGenerating
        ) {
            return;
        }

        window.speechSynthesis.cancel();

        clearInterval(lipSyncInterval);

        characterImage.src = closedMouthImg;

        const utterance = new SpeechSynthesisUtterance(text);

        const selectedVoice = voices.find(
            voice => voice.name === voiceSelect.value
        );

        if (selectedVoice) {

            utterance.voice = selectedVoice;

            utterance.lang = selectedVoice.lang;
        }

        const isHindi =
            selectedVoice &&
            selectedVoice.lang.toLowerCase().startsWith('hi');

        utterance.pitch = isHindi ? 1.0 : 1.15;

        utterance.rate = isHindi ? 1.0 : 1.05;

        utterance.onstart = () => {

            let mouthOpen = true;

            lipSyncInterval = setInterval(() => {

                characterImage.src = mouthOpen
                    ? openMouthImg
                    : closedMouthImg;

                mouthOpen = !mouthOpen;

            }, 160);

        };

        const stopAnimation = () => {

            clearInterval(lipSyncInterval);

            lipSyncInterval = null;

            characterImage.src = closedMouthImg;
        };

        utterance.onend = stopAnimation;

        utterance.onerror = stopAnimation;

        window.speechSynthesis.speak(utterance);
    }

    // ==========================================
    // 8. STOP SPEAKING
    // ==========================================

    function stopSpeaking() {

        if ('speechSynthesis' in window) {

            window.speechSynthesis.cancel();
        }

        clearInterval(lipSyncInterval);

        lipSyncInterval = null;

        characterImage.src = closedMouthImg;
    }

    // ==========================================
    // 9. GENERATION UI STATE
    // ==========================================

    function setGeneratingState(generating) {

        isGenerating = generating;

        textInput.disabled = generating;

        sendButton.disabled = generating;

        if (generating) {

            sendButton.style.display = 'none';

            stopButton.style.display = 'flex';

        } else {

            stopButton.style.display = 'none';

            sendButton.style.display = 'flex';

            sendButton.disabled = false;

            textInput.disabled = false;

            textInput.focus();
        }
    }

    // ==========================================
    // 10. STOP GENERATION
    // ==========================================

    async function stopGeneration() {

        if (!isGenerating) {
            return;
        }

        console.log('Waku AI: Stopping generation...');

        // Invalidate the current generation.

        generationId++;

        const controller = currentAbortController;

        const reader = currentReader;

        // Clear references immediately.

        currentAbortController = null;

        currentReader = null;

        // Stop browser speech.

        stopSpeaking();

        // Remove typing animation.

        removeTypingIndicator();

        // Immediately cancel the active frontend request.

        if (controller) {
            controller.abort();
        }

        // Cancel stream reader if available.

        if (reader) {

            try {
                await reader.cancel();
            } catch (error) {
                console.warn('Stream cancellation:', error);
            }
        }

        // Notify the backend separately.

        // This requires a corresponding /chat/stop route in app.py.

        fetch('/chat/stop', {

            method: 'POST',

            headers: {
                'Content-Type': 'application/json'
            },

            body: JSON.stringify({
                session_id: sessionId
            })

        }).catch(error => {

            console.warn(
                'Backend cancellation request failed:',
                error
            );

        });

        // Reset interface immediately.

        setGeneratingState(false);

        console.log('Waku AI: Generation stopped.');
    }

    stopButton.addEventListener('click', stopGeneration);

    // ==========================================
    // 11. PROCESS STREAM DATA
    // ==========================================

    function processStreamLine(line, state) {

        if (!line.startsWith('data:')) {
            return;
        }

        const rawJson = line.substring(5).trim();

        if (!rawJson) {
            return;
        }

        let data;

        try {

            data = JSON.parse(rawJson);

        } catch (error) {

            console.warn('Invalid SSE JSON:', error);

            return;
        }

        if (data.type === 'chunk' && data.text) {

            if (!state.wakuBubble) {

                removeTypingIndicator();

                state.wakuBubble = appendMessage('waku', '');
            }

            state.wakuBubble.textContent += data.text;

            state.accumulatedText += data.text;

            chatMessages.scrollTop = chatMessages.scrollHeight;

        } else if (data.type === 'done') {

            if (data.full_text && !state.accumulatedText) {

                if (!state.wakuBubble) {

                    removeTypingIndicator();

                    state.wakuBubble = appendMessage('waku', '');
                }

                state.wakuBubble.textContent = data.full_text;

                state.accumulatedText = data.full_text;
            }

            state.completed = true;

        } else if (data.type === 'error') {

            state.serverError =
                data.error || 'Server error occurred.';
        }
    }

    // ==========================================
    // 12. SEND MESSAGE AND STREAM RESPONSE
    // ==========================================

    async function handleSendMessage() {

        if (isGenerating) {
            return;
        }

        const message = textInput.value.trim();

        if (!message) {
            return;
        }

        // Create a unique ID for this generation.

        const thisGeneration = ++generationId;

        // Clear input.

        textInput.value = '';

        textInput.style.height = '46px';

        // Display user message.

        appendMessage('user', message);

        // Activate generation interface.

        setGeneratingState(true);

        showTypingIndicator();

        // Determine selected voice language.

        const selectedVoice = voices.find(
            voice => voice.name === voiceSelect.value
        );

        const voiceLanguage =
            selectedVoice ? selectedVoice.lang : 'en-US';

        // Create cancellation controller.

        const controller = new AbortController();

        currentAbortController = controller;

        const state = {

            wakuBubble: null,

            accumulatedText: '',

            completed: false,

            serverError: null

        };

        try {

            // ==================================
            // SEND REQUEST
            // ==================================

            const response = await fetch('/chat/stream', {

                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },

                body: JSON.stringify({

                    message: message,

                    session_id: sessionId,

                    language: voiceLanguage

                }),

                signal: controller.signal

            });

            if (thisGeneration !== generationId) {
                return;
            }

            if (!response.ok) {

                throw new Error(
                    `Server returned HTTP ${response.status}`
                );
            }

            if (!response.body) {

                throw new Error(
                    'Streaming response is not supported.'
                );
            }

            // ==================================
            // READ STREAM
            // ==================================

            const reader = response.body.getReader();

            currentReader = reader;

            const decoder = new TextDecoder('utf-8');

            let buffer = '';

            while (true) {

                if (thisGeneration !== generationId) {
                    break;
                }

                const { value, done } = await reader.read();

                if (done) {
                    break;
                }

                buffer += decoder.decode(value, {
                    stream: true
                });

                const lines = buffer.split('\n');

                buffer = lines.pop() || '';

                for (const line of lines) {

                    if (thisGeneration !== generationId) {
                        break;
                    }

                    processStreamLine(line, state);

                    if (state.serverError) {

                        throw new Error(state.serverError);
                    }
                }
            }

            // Process any remaining buffered data.

            if (
                thisGeneration === generationId &&
                buffer.trim()
            ) {

                processStreamLine(buffer, state);
            }

            if (thisGeneration !== generationId) {
                return;
            }

            removeTypingIndicator();

            // ==================================
            // FINAL RESPONSE
            // ==================================

            if (state.accumulatedText) {

                speak(state.accumulatedText);

            } else if (!state.wakuBubble) {

                appendMessage(
                    'waku',
                    "I heard you, but I wasn't able to generate a response. Could you try asking again?"
                );
            }

        } catch (error) {

            if (thisGeneration !== generationId) {
                return;
            }

            removeTypingIndicator();

            if (error.name === 'AbortError') {

                console.log(
                    'Waku AI: Request cancelled.'
                );

            } else {

                console.error('Chat error:', error);

                const errorMsg =
                    'Sorry, I had trouble connecting. Please check if the server is running and try again.';

                if (!state.wakuBubble) {

                    appendMessage('waku', errorMsg);

                } else {

                    state.wakuBubble.textContent +=
                        `\n[${errorMsg}]`;
                }
            }

        } finally {

            // Only the active request can reset the UI.

            if (thisGeneration === generationId) {

                currentAbortController = null;

                currentReader = null;

                setGeneratingState(false);
            }
        }
    }

    // ==========================================
    // 13. SEND BUTTON
    // ==========================================

    sendButton.addEventListener(
        'click',
        handleSendMessage
    );

    // ==========================================
    // 14. ENTER KEY SUPPORT
    // ==========================================

    textInput.addEventListener('keydown', (event) => {

        if (
            event.key === 'Enter' &&
            !event.shiftKey
        ) {

            event.preventDefault();

            handleSendMessage();
        }
    });

    // ==========================================
    // 15. AUTO-GROW TEXTAREA
    // ==========================================

    textInput.addEventListener('input', () => {

        textInput.style.height = 'auto';

        textInput.style.height =
            `${Math.min(textInput.scrollHeight, 130)}px`;
    });

    // ==========================================
    // 16. INITIAL UI STATE
    // ==========================================

    stopButton.style.display = 'none';

    sendButton.style.display = 'flex';

    console.log('Waku AI frontend initialized successfully.');

});