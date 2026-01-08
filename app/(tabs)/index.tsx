// index.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Pressable,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import io, { Socket } from 'socket.io-client';

// TYPES
type MessageType = {
  type: 'system' | 'morse' | 'text';
  username?: string;
  message?: string;
  morseCode?: string;
  text?: string;
  timestamp: number;
};

// MORSE CODE MAPPING
const MORSE_CODE: { [key: string]: string } = {
  'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
  'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
  'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
  'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
  'Y': '-.--', 'Z': '--..', '0': '-----', '1': '.----', '2': '..---',
  '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...',
  '8': '---..', '9': '----.', ' ': '/'
};

const MORSE_TO_CHAR: { [key: string]: string } = Object.fromEntries(
  Object.entries(MORSE_CODE).map(([k, v]) => [v, k])
);

export default function App() {
  const [screen, setScreen] = useState<'join' | 'chat'>('join');
  const [username, setUsername] = useState<string>('');
  const [roomId, setRoomId] = useState<string>('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [morseInput, setMorseInput] = useState<string>('');
  const [decodedText, setDecodedText] = useState<string>('');
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [isPressed, setIsPressed] = useState<boolean>(false);
  const [users, setUsers] = useState<string[]>([]);

  const pressStartTime = useRef<number | null>(null);
  const morseTimeout = useRef<number | null>(null);
  const letterTimeout = useRef<number | null>(null);
  const dotSound = useRef<any>(null);
  const dashSound = useRef<any>(null);

  // SERVER URL - CHANGE THIS TO YOUR DEPLOYED SERVER
  const SERVER_URL = 'http://192.168.1.100:3000'; // Change to your server IP or deployed URL

  useEffect(() => {
    setupAudio();
    return () => {
      if (dotSound.current) {
        dotSound.current.unloadAsync();
      }
      if (dashSound.current) {
        dashSound.current.unloadAsync();
      }
    };
  }, []);

  const setupAudio = async () => {
    try {
      // Load sounds once
      const dotResult = await Audio.Sound.createAsync(
        { uri: 'https://www.soundjay.com/buttons/sounds/beep-07a.mp3' }
      );
      const dashResult = await Audio.Sound.createAsync(
        { uri: 'https://www.soundjay.com/buttons/sounds/beep-08b.mp3' }
      );
      dotSound.current = dotResult.sound;
      dashSound.current = dashResult.sound;
    } catch (error) {
      console.log('Error setting up audio:', error);
    }
  };

  const playBeep = async (duration: 'short' | 'long') => {
    try {
      const sound = duration === 'short' ? dotSound.current : dashSound.current;
      if (sound) {
        await sound.replayAsync();
      }
    } catch (error) {
      console.log('Error playing sound:', error);
    }
  };

  const generateRoomId = () => {
    const randomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(randomId);
  };

  const joinRoom = () => {
    if (!username.trim() || !roomId.trim()) {
      Alert.alert('Error', 'Please enter username and room ID');
      return;
    }

    const newSocket = io(SERVER_URL);
    
    newSocket.on('connect', () => {
      console.log('Connected to server');
      newSocket.emit('join-room', { roomId, username });
      setScreen('chat');
    });

    newSocket.on('user-joined', (data: { username: string; message: string }) => {
      setMessages(prev => [...prev, {
        type: 'system',
        message: data.message,
        timestamp: Date.now()
      }]);
    });

    newSocket.on('user-left', (data: { username: string; message: string }) => {
      setMessages(prev => [...prev, {
        type: 'system',
        message: data.message,
        timestamp: Date.now()
      }]);
    });

    newSocket.on('room-users', (data: { users: string[] }) => {
      setUsers(data.users);
    });

    newSocket.on('receive-morse', (data: { 
      username: string; 
      morseSignal: string; 
      morseCode: string; 
      text: string; 
      timestamp: number;
    }) => {
      playBeep(data.morseSignal === '.' ? 'short' : 'long');
      setMessages(prev => [...prev, {
        type: 'morse',
        username: data.username,
        morseCode: data.morseCode,
        text: data.text,
        timestamp: data.timestamp
      }]);
    });

    newSocket.on('receive-message', (data: { 
      username: string; 
      message: string; 
      timestamp: number;
    }) => {
      setMessages(prev => [...prev, {
        type: 'text',
        username: data.username,
        message: data.message,
        timestamp: data.timestamp
      }]);
    });

    setSocket(newSocket);
  };

  const handlePressIn = () => {
    setIsPressed(true);
    pressStartTime.current = Date.now();
    playBeep('short');

    // Clear timeouts
    if (morseTimeout.current) clearTimeout(morseTimeout.current);
    if (letterTimeout.current) clearTimeout(letterTimeout.current);
  };

  const handlePressOut = () => {
    setIsPressed(false);
    const pressDuration = Date.now() - (pressStartTime.current || 0);
    
    // Determine if dot or dash (threshold: 200ms)
    const signal = pressDuration < 200 ? '.' : '-';
    const newMorseInput = morseInput + signal;
    setMorseInput(newMorseInput);

    // Try to decode after short pause (800ms)
    morseTimeout.current = setTimeout(() => {
      decodeMorse(newMorseInput);
    }, 800);

    // Reset after longer pause (2000ms)
    letterTimeout.current = setTimeout(() => {
      setMorseInput('');
    }, 2000);
  };

  const decodeMorse = (morse: string) => {
    if (!morse) return;

    const decoded = MORSE_TO_CHAR[morse];
    if (decoded) {
      const newText = decodedText + decoded;
      setDecodedText(newText);
      
      // Send to server
      if (socket) {
        socket.emit('send-morse', {
          roomId,
          morseSignal: morse[morse.length - 1],
          morseCode: morse,
          text: newText
        });
      }

      setMorseInput('');
    }
  };

  const clearMessage = () => {
    setDecodedText('');
    setMorseInput('');
  };

  if (screen === 'join') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.joinContainer}>
          <Text style={styles.title}>📡 Morse Code Chat</Text>
          <Text style={styles.subtitle}>Communicate with beeps!</Text>
          
          <TextInput
            style={styles.input}
            placeholder="Enter your name"
            value={username}
            onChangeText={setUsername}
          />
          
          <View style={styles.roomInputContainer}>
            <TextInput
              style={[styles.input, styles.roomInput]}
              placeholder="Enter or create room ID"
              value={roomId}
              onChangeText={setRoomId}
            />
            <TouchableOpacity style={styles.generateButton} onPress={generateRoomId}>
              <Text style={styles.generateButtonText}>🎲</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.infoText}>
            💡 Share the same Room ID with your friend to connect!
          </Text>
          
          <TouchableOpacity style={styles.joinButton} onPress={joinRoom}>
            <Text style={styles.joinButtonText}>Join Room</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Room: {roomId}</Text>
        <Text style={styles.headerSubtitle}>👤 {users.length} online</Text>
      </View>

      <ScrollView style={styles.messagesContainer}>
        {messages.map((msg, idx) => (
          <View key={idx} style={[
            styles.message,
            msg.type === 'system' && styles.systemMessage
          ]}>
            {msg.type === 'system' ? (
              <Text style={styles.systemText}>{msg.message}</Text>
            ) : (
              <>
                <Text style={styles.messageUsername}>{msg.username}</Text>
                {msg.morseCode && (
                  <Text style={styles.morseCode}>{msg.morseCode}</Text>
                )}
                <Text style={styles.messageText}>{msg.text || msg.message}</Text>
              </>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputArea}>
        <View style={styles.displayArea}>
          <Text style={styles.morseDisplay}>{morseInput}</Text>
          <Text style={styles.textDisplay}>{decodedText}</Text>
        </View>

        <Pressable
          style={[styles.morseButton, isPressed && styles.morseButtonPressed]}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Text style={styles.morseButtonText}>
            {isPressed ? '🔊' : 'TAP'}
          </Text>
          <Text style={styles.morseButtonHint}>
            Short tap = dot • Long press = dash —
          </Text>
        </Pressable>

        <TouchableOpacity style={styles.clearButton} onPress={clearMessage}>
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e27',
  },
  joinContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: '#888',
    marginBottom: 40,
  },
  input: {
    width: '100%',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    fontSize: 16,
  },
  roomInputContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roomInput: {
    flex: 1,
    marginBottom: 0,
  },
  generateButton: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 10,
    width: 60,
    height: 55,
    justifyContent: 'center',
    alignItems: 'center',
  },
  generateButtonText: {
    fontSize: 24,
  },
  infoText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  joinButton: {
    width: '100%',
    backgroundColor: '#4CAF50',
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
  },
  joinButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  header: {
    backgroundColor: '#1a1f3a',
    padding: 15,
    borderBottomWidth: 2,
    borderBottomColor: '#4CAF50',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#888',
    fontSize: 14,
    marginTop: 5,
  },
  messagesContainer: {
    flex: 1,
    padding: 15,
  },
  message: {
    backgroundColor: '#1a1f3a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  systemMessage: {
    backgroundColor: '#2a2f4a',
    alignItems: 'center',
  },
  systemText: {
    color: '#888',
    fontSize: 14,
    fontStyle: 'italic',
  },
  messageUsername: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  morseCode: {
    color: '#FFD700',
    fontSize: 18,
    fontFamily: 'monospace',
    marginBottom: 5,
  },
  messageText: {
    color: '#fff',
    fontSize: 16,
  },
  inputArea: {
    padding: 15,
    backgroundColor: '#1a1f3a',
  },
  displayArea: {
    backgroundColor: '#0a0e27',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    minHeight: 60,
  },
  morseDisplay: {
    color: '#FFD700',
    fontSize: 24,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 5,
  },
  textDisplay: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
  },
  morseButton: {
    backgroundColor: '#4CAF50',
    padding: 40,
    borderRadius: 20,
    alignItems: 'center',
    marginBottom: 10,
  },
  morseButtonPressed: {
    backgroundColor: '#45a049',
    transform: [{ scale: 0.95 }],
  },
  morseButtonText: {
    color: '#fff',
    fontSize: 36,
    fontWeight: 'bold',
  },
  morseButtonHint: {
    color: '#fff',
    fontSize: 12,
    marginTop: 10,
    opacity: 0.7,
  },
  clearButton: {
    backgroundColor: '#f44336',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  clearButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

/* 
Install these packages:
npm install expo-av react-native-safe-area-context

package.json dependencies:
{
  "dependencies": {
    "expo": "~52.0.0",
    "expo-av": "~14.0.0",
    "react": "18.3.1",
    "react-native": "0.76.5",
    "react-native-safe-area-context": "4.12.0",
    "socket.io-client": "^4.6.1"
  }
}
*/