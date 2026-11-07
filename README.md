# 🐾 Waku AI — Your AI Cat Companion

[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Flask 3.x](https://img.shields.io/badge/Framework-Flask-black.svg)](https://flask.palletsprojects.com/)
[![Google ADK](https://img.shields.io/badge/SDK-Google%20ADK-4285F4.svg)](https://google.github.io/adk-docs/)
[![Gemini](https://img.shields.io/badge/Powered%20By-Gemini-orange.svg)](https://aistudio.google.com/)

**Waku AI** is a beginner-friendly conversational AI companion built with the **Google Agent Development Kit (ADK)**, the **Gemini API**, and **Flask**. Waku is an intelligent, charming cat companion that chats, thinks, and responds with animated mascot lip-syncing and browser-based text-to-speech.

---

## 🌟 Overview

Waku AI demonstrates how to build an interactive virtual character agent using Google's Agent Development Kit (ADK). The application pairs a modern, responsive web interface with a persistent conversational agent that remembers context throughout the dialogue session.

---

## ✨ Features

- **🐾 Charming AI Companion**: Created by **Aryan Srivastava**, Waku acts as your intelligent, empathetic, and approachable companion.
- **⚡ Real-Time Streaming & Stop Control**: Streams responses live with real-time word-by-word rendering and an instant Stop Response button.
- **💬 Dual-Aligned Conversation UI**: User messages on the right, Waku responses on the left, with autoscroll, typing indicators, and mobile-friendly design.
- **🗣️ Dynamic Lip-Sync & Voice**: Features synchronized mouth animations and speech synthesis using the browser's Web Speech API.
- **🧠 Google ADK Architecture**: Powered by `LlmAgent` and `InMemoryRunner` from Google's Agent Development Kit.
- **🔒 Secure & Configurable**: Clean separation of secrets via environment variables (`.env`).

---

## 🛠️ Technology Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Backend** | Python 3.10+ & Flask | Lightweight asynchronous web server |
| **Agent Framework** | Google ADK (`google-adk`) | Manages agent persona, lifecycle, and sessions |
| **LLM Provider** | Google Gemini (`gemini-3.5-flash`) | Core intelligence and generative dialogue |
| **Frontend** | HTML5, CSS3, Vanilla JS | Modern, responsive dark-mode UI |
| **Audio & Animation** | Web Speech API | Text-to-speech with frame-synced lip animation |

---

## 📁 Project Structure

```text
companion-python/
├── app.py                  # Flask web application and ADK runner integration
├── character.py            # Waku agent definition, personality prompt, & model settings
├── requirements.txt        # Core Python package dependencies
├── .env.example            # Sample environment variables template
├── .gitignore              # Git ignore rules for virtual environments & secrets
├── README.md               # Project documentation
├── static/
│   ├── app.js              # Frontend logic (lip-sync, speech synthesis, typewriter)
│   ├── style.css           # Responsive modern dark-theme styles
│   └── images/
│       ├── char-mouth-closed.png   # Mascot resting state
│       └── char-mouth-open.png     # Mascot speaking state
├── templates/
│   └── index.html          # Main chat companion web page
└── skills/
    └── skill.md            # Reference documentation for Google ADK Python
```

---

## 🚀 Getting Started

### Prerequisites

- **Python**: Version 3.10, 3.11, or 3.12 installed.
- **Gemini API Key**: A free API key from [Google AI Studio](https://aistudio.google.com/).

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/waku-ai.git
cd waku-ai
```

### 2. Set Up a Virtual Environment

```bash
# Create virtual environment
python3 -m venv .venv

# Activate virtual environment (Linux/macOS)
source .venv/bin/activate

# On Windows:
# .venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Copy `.env.example` to create your local `.env` file:

```bash
cp .env.example .env
```

Open `.env` and insert your Gemini API key:

```ini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash
HOST=0.0.0.0
PORT=5000
```

---

## 🎮 Running the Application

Start the Flask server on the default port (`5000`):

```bash
python app.py
```

### Specifying a Custom Port

You can specify any port in three ways:

```bash
# 1. Positional argument
python app.py 8080

# 2. Flag argument
python app.py --port 8080

# 3. Environment variable
PORT=8080 python app.py
```

Once started, open your browser and navigate to:
```text
http://localhost:5000
```

*(If running in **Google Cloud Shell**, click the **Web Preview** icon at the top right, select **Change port**, enter `5000`, and click **Change and Preview**).*

---

## 💬 Example Interactions

Here is a glimpse of chatting with Waku:

> **User**: *Hello Waku! What have you been up to today?*
> **Waku**: *Meow! I've been on high alert guarding the living room from a very sneaky sunbeam. It put up a good chase across the rug, but I prevailed! What exciting adventures are you up to today?*

> **User**: *Can you help me understand what an API is in simple terms?*
> **Waku**: *Think of an API like a waiter at a cozy café! You look at the menu, tell the waiter what you'd like, and they scamper over to the kitchen to fetch it and bring it right back to your table. In software, it lets two programs talk to each other without either needing to know how the other's kitchen works!*

> **User**: *Thanks! Can you give another example of that?*
> **Waku**: *Of course! Imagine a weather app on your phone. Your phone doesn't have its own weather satellite—it uses an API to ask a weather service, "Hey, will it rain today?", and the service sends back the forecast!*

---

## 🔮 Future Improvements

- **Multiple Mascot Expressions**: Add blinking, thinking, and joyful facial expressions.
- **Custom Sound Effects**: Add subtle playful audio cues (soft purrs, chimes).
- **Session Reset Button**: Provide an in-UI button to start a fresh conversation session.
- **Export Chat History**: Allow users to download or copy their conversation highlights.

---

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).
