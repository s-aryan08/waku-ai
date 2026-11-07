/**
 * Waku AI - Companion Frontend Logic
 * Features real-time streaming, speech synthesis lip-sync, stop generation,
 * and responsive chat alignment.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Unique session ID preserved across turns for conversation context
    const sessionId = 'waku_session_' + Math.random().toString(36).substring(2, 12);

    const chatMessages = document.getElementById('chat-messages');
    const textInput = document.getElementById('text-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');
    const characterImage = document.getElementById('character-image');
    const voiceSelect = document.getElementById('voice-select');

    const openMouthImg = `/static/images/char-mouth-open.png?v=${sessionId}`;
    const closedMouthImg = `/static/images/char-mouth-closed.png?v=${sessionId}`;

    // Preload mascot images
    characterImage.src = closedMouthImg;
    const preloadOpen = new Image();
    preloadOpen.src = openMouthImg;
    const preloadClosed = new Image();
    preloadClosed.src = closedMouthImg;

    let voices = [];
    let lipSyncInterval = null;
    let currentAbortController = null;
    let isGenerating = false;

    /**
     * Populates speech synthesis voices into dropdown.
     */
    function populateVoiceList() {
        if (!('speechSynthesis' in window)) {
            voiceSelect.style.display = 'none';
            return;
        }

        const allVoices = window.speechSynthesis.getVoices();
        if (!allVoices || allVoices.length === 0) return;

        voices = allVoices;
        voiceSelect.innerHTML = '';
        let selectedIndex = 0;

        voices.forEach((voice, index) => {
            const option = document.createElement('option');
            option.textContent = `${voice.name} (${voice.lang})`;
            option.value = voice.name;
            voiceSelect.appendChild(option);

            // Default to an en-US voice if available, otherwise first voice
            if (voice.lang === 'en-US' && selectedIndex === 0) {
                selectedIndex = index;
            }
        });

        if (voices.length > 0) {
            voiceSelect.selectedIndex = selectedIndex;
        }
    }

    populateVoiceList();
    if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = populateVoiceList;
    }

    /**
     * Appends a chat bubble to the message history and autoscrolls.
     */
    function appendMessage(role, text = '') {
        const row = document.createElement('div');
        row.className = `message-row ${role === 'user' ? 'user-row' : 'waku-row'}`;

        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${role === 'user' ? 'user-bubble' : 'waku-bubble'}`;
        bubble.textContent = text;

        row.appendChild(bubble);
        chatMessages.appendChild(row);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        return bubble;
    }

    /**
     * Displays an animated typing indicator in Waku's row on the left.
     */
    function showTypingIndicator() {
        const row = document.createElement('div');
        row.className = 'message-row waku-row typing-row';
        row.id = 'typing-indicator';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble waku-bubble typing-bubble';
        bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';

        row.appendChild(bubble);
        chatMessages.appendChild(row);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    /**
     * Removes typing indicator from the chat log.
     */
    function removeTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * Speaks text using SpeechSynthesis with synchronized mascot mouth animation.
     */
    function speak(text) {
        if (!('speechSynthesis' in window) || !text) return;

        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
        }
        clearInterval(lipSyncInterval);
        characterImage.src = closedMouthImg;

        const utterance = new SpeechSynthesisUtterance(text);
        const selectedVoiceName = voiceSelect.value;
        const selectedVoice = voices.find(v => v.name === selectedVoiceName);

        if (selectedVoice) {
            utterance.voice = selectedVoice;
            utterance.lang = selectedVoice.lang;
        }

        const isHindi = selectedVoice && selectedVoice.lang.toLowerCase().startsWith('hi');
        utterance.pitch = isHindi ? 1.0 : 1.15;
        utterance.rate = isHindi ? 1.0 : 1.05;

        utterance.onstart = () => {
            let mouthOpen = true;
            lipSyncInterval = setInterval(() => {
                characterImage.src = mouthOpen ? openMouthImg : closedMouthImg;
                mouthOpen = !mouthOpen;
            }, 160);
        };

        const stopAnimation = () => {
            clearInterval(lipSyncInterval);
            characterImage.src = closedMouthImg;
        };

        utterance.onend = stopAnimation;
        utterance.onerror = stopAnimation;

        window.speechSynthesis.speak(utterance);
    }

    /**
     * Stops speaking and resets mascot mouth state.
     */
    function stopSpeaking() {
        if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
        }
        clearInterval(lipSyncInterval);
        characterImage.src = closedMouthImg;
    }

    /**
     * Toggles UI loading states and button visibility.
     */
    function setGeneratingState(generating) {
        isGenerating = generating;
        textInput.disabled = generating;

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

    /**
     * Cancels the active generation immediately.
     */
    async function stopGeneration() {
        if (!isGenerating) return;

        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
        }

        stopSpeaking();
        removeTypingIndicator();

        // Notify backend to cancel the runner task
        try {
            await fetch('/chat/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId }),
            });
        } catch (e) {
            // Ignore network errors on cancellation
        }

        setGeneratingState(false);
    }

    stopButton.addEventListener('click', stopGeneration);

    /**
     * Sends user message and streams Waku's response chunk-by-chunk.
     */
    async function handleSendMessage() {
        if (isGenerating) return;

        const message = textInput.value.trim();
        if (!message) return;

        // Reset input field height
        textInput.value = '';
        textInput.style.height = '46px';

        // 1. Append User message on the RIGHT
        appendMessage('user', message);

        // 2. Set generating state and show typing indicator on the LEFT
        setGeneratingState(true);
        showTypingIndicator();

        // 3. Prepare voice locale
        const selectedVoiceName = voiceSelect.value;
        const selectedVoice = voices.find(v => v.name === selectedVoiceName);
        const voiceLanguage = selectedVoice ? selectedVoice.lang : 'en-US';

        currentAbortController = new AbortController();
        let wakuBubble = null;
        let accumulatedText = '';

        try {
            const response = await fetch('/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message,
                    session_id: sessionId,
                    language: voiceLanguage,
                }),
                signal: currentAbortController.signal,
            });

            if (!response.ok) {
                throw new Error(`Server returned HTTP ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep partial trailing line

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const rawJson = line.substring(6).trim();
                        if (!rawJson) continue;

                        try {
                            const data = JSON.parse(rawJson);

                            if (data.type === 'chunk' && data.text) {
                                // Remove typing indicator on first chunk arrival
                                if (!wakuBubble) {
                                    removeTypingIndicator();
                                    wakuBubble = appendMessage('waku', '');
                                }
                                wakuBubble.textContent += data.text;
                                accumulatedText += data.text;
                                chatMessages.scrollTop = chatMessages.scrollHeight;
                            } else if (data.type === 'done') {
                                if (data.full_text && !accumulatedText) {
                                    if (!wakuBubble) {
                                        removeTypingIndicator();
                                        wakuBubble = appendMessage('waku', '');
                                    }
                                    wakuBubble.textContent = data.full_text;
                                    accumulatedText = data.full_text;
                                }
                            } else if (data.type === 'error') {
                                throw new Error(data.error || 'Server error occurred');
                            }
                        } catch (parseErr) {
                            console.warn('Error parsing SSE chunk:', parseErr);
                        }
                    }
                }
            }

            removeTypingIndicator();

            // Speak the response if text was received
            if (accumulatedText) {
                speak(accumulatedText);
            } else if (!wakuBubble) {
                wakuBubble = appendMessage('waku', "I heard you, but I wasn't able to generate a response. Could you try asking again?");
            }

        } catch (error) {
            removeTypingIndicator();

            if (error.name === 'AbortError') {
                // User clicked Stop button: preserve whatever text was received
                console.log('Response generation cancelled by user.');
            } else {
                console.error('Chat error:', error);
                const errorMsg = "Sorry, I had trouble connecting. Please check if the server is running and try again.";
                if (!wakuBubble) {
                    appendMessage('waku', errorMsg);
                } else {
                    wakuBubble.textContent += `\n[${errorMsg}]`;
                }
            }
        } finally {
            currentAbortController = null;
            setGeneratingState(false);
        }
    }

    sendButton.addEventListener('click', handleSendMessage);

    textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Auto-grow textarea up to max height
    textInput.addEventListener('input', () => {
        textInput.style.height = 'auto';
        textInput.style.height = `${Math.min(textInput.scrollHeight, 130)}px`;
    });
});
