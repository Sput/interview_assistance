import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, AlertCircle, MessageCircle } from 'lucide-react';

interface Message {
  id: string;
  text: string;
  type: 'user' | 'assistant';
  timestamp: Date;
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string>('');
  const [currentTranscript, setCurrentTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const speechSynthesis = window.speechSynthesis;

    if (!SpeechRecognition || !speechSynthesis) {
      setIsSupported(false);
      setError('Your browser does not support speech recognition or synthesis. Please use Chrome or Safari.');
      return;
    }

    // Initialize speech recognition
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setVoiceState('listening');
      setError('');
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      setCurrentTranscript(interimTranscript);

      if (finalTranscript) {
        handleUserSpeech(finalTranscript.trim());
      }
    };

    recognition.onerror = (event) => {
      setError(`Speech recognition error: ${event.error}`);
      setVoiceState('idle');
      setCurrentTranscript('');
    };

    recognition.onend = () => {
      if (voiceState === 'listening') {
        setVoiceState('idle');
        setCurrentTranscript('');
      }
    };

    recognitionRef.current = recognition;
    synthRef.current = speechSynthesis;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, [voiceState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleUserSpeech = (text: string) => {
    if (!text) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text,
      type: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setCurrentTranscript('');
    setVoiceState('processing');

    // Simulate AI processing and generate response
    setTimeout(() => {
      generateResponse(text);
    }, 1000);
  };

  const generateResponse = (userInput: string) => {
    // Simple response generation (in a real app, this would be an AI API call)
    const responses = [
      `I heard you say "${userInput}". That's interesting!`,
      `Thanks for saying "${userInput}". How can I help you further?`,
      `You mentioned "${userInput}". Would you like to elaborate on that?`,
      `Regarding "${userInput}", I'd be happy to discuss this topic with you.`,
      `I understand you're talking about "${userInput}". Tell me more!`
    ];

    const responseText = responses[Math.floor(Math.random() * responses.length)];
    
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      text: responseText,
      type: 'assistant',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, assistantMessage]);
    speakText(responseText);
  };

  const speakText = (text: string) => {
    if (!synthRef.current || !isSupported) return;

    setVoiceState('speaking');
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onend = () => {
      setVoiceState('idle');
    };

    utterance.onerror = (event) => {
      setError(`Speech synthesis error: ${event.error}`);
      setVoiceState('idle');
    };

    synthRef.current.speak(utterance);
  };

  const toggleListening = () => {
    if (!recognitionRef.current || !isSupported) return;

    if (voiceState === 'listening') {
      recognitionRef.current.stop();
      setVoiceState('idle');
      setCurrentTranscript('');
    } else if (voiceState === 'idle') {
      recognitionRef.current.start();
    }
  };

  const stopSpeaking = () => {
    if (synthRef.current && voiceState === 'speaking') {
      synthRef.current.cancel();
      setVoiceState('idle');
    }
  };

  const getStateColor = () => {
    switch (voiceState) {
      case 'listening': return 'bg-green-500 shadow-green-500/50';
      case 'processing': return 'bg-yellow-500 shadow-yellow-500/50';
      case 'speaking': return 'bg-blue-500 shadow-blue-500/50';
      default: return 'bg-gray-400 shadow-gray-500/50';
    }
  };

  const getStateText = () => {
    switch (voiceState) {
      case 'listening': return 'Listening...';
      case 'processing': return 'Processing...';
      case 'speaking': return 'Speaking...';
      default: return 'Click to start';
    }
  };

  if (!isSupported) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Not Supported</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <p className="text-sm text-gray-500">
            Please use a modern browser like Chrome or Safari for the best experience.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-full shadow-lg mb-4">
            <MessageCircle className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Voice Assistant</h1>
          <p className="text-lg text-gray-600">Speak naturally and I'll respond with voice</p>
        </div>

        {/* Main Interface */}
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Messages Area */}
          <div className="h-96 overflow-y-auto p-6 bg-gray-50">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <Mic className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p className="text-lg">Start a conversation by clicking the microphone</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl ${
                        message.type === 'user'
                          ? 'bg-blue-500 text-white rounded-br-md'
                          : 'bg-white text-gray-800 shadow-md rounded-bl-md'
                      }`}
                    >
                      <p className="text-sm leading-relaxed">{message.text}</p>
                      <p className={`text-xs mt-1 ${
                        message.type === 'user' ? 'text-blue-100' : 'text-gray-500'
                      }`}>
                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
                {currentTranscript && (
                  <div className="flex justify-end">
                    <div className="max-w-xs lg:max-w-md px-4 py-3 rounded-2xl bg-blue-100 text-blue-800 rounded-br-md opacity-75">
                      <p className="text-sm leading-relaxed">{currentTranscript}</p>
                      <p className="text-xs mt-1 text-blue-600">Speaking...</p>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="p-6 bg-white border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{getStateText()}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {voiceState === 'idle' && 'Ready to listen'}
                  {voiceState === 'listening' && 'Say something...'}
                  {voiceState === 'processing' && 'Thinking about your message'}
                  {voiceState === 'speaking' && 'Playing response'}
                </p>
                {error && (
                  <p className="text-xs text-red-500 mt-1 flex items-center">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    {error}
                  </p>
                )}
              </div>

              <div className="flex items-center space-x-4">
                {/* Stop Speaking Button */}
                {voiceState === 'speaking' && (
                  <button
                    onClick={stopSpeaking}
                    className="flex items-center justify-center w-12 h-12 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-all duration-200 hover:scale-105"
                  >
                    <Volume2 className="w-5 h-5" />
                  </button>
                )}

                {/* Main Microphone Button */}
                <button
                  onClick={toggleListening}
                  disabled={voiceState === 'processing' || voiceState === 'speaking'}
                  className={`relative flex items-center justify-center w-16 h-16 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed ${getStateColor()}`}
                >
                  {voiceState === 'listening' ? (
                    <MicOff className="w-7 h-7 text-white" />
                  ) : (
                    <Mic className="w-7 h-7 text-white" />
                  )}
                  
                  {/* Pulsing animation for listening state */}
                  {voiceState === 'listening' && (
                    <div className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-20"></div>
                  )}
                  
                  {/* Processing spinner */}
                  {voiceState === 'processing' && (
                    <div className="absolute inset-0 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-8 text-center">
          <div className="grid md:grid-cols-3 gap-4 max-w-2xl mx-auto">
            <div className="bg-white rounded-xl p-4 shadow-md">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <span className="text-blue-600 font-bold">1</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Click Microphone</h3>
              <p className="text-sm text-gray-600">Tap the microphone button to start listening</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-md">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <span className="text-green-600 font-bold">2</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Speak Clearly</h3>
              <p className="text-sm text-gray-600">Say your message naturally and clearly</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-md">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <span className="text-purple-600 font-bold">3</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Listen to Response</h3>
              <p className="text-sm text-gray-600">I'll process and respond with voice</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;