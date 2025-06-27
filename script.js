const dom = {
    playerScore: document.getElementById('player-score'),
    aiScore: document.getElementById('ai-score'),
    gameImage: document.getElementById('game-image'),
    imagePlaceholder: document.getElementById('image-placeholder'),
    startCameraBtn: document.getElementById('start-camera-btn'),
    cameraStream: document.getElementById('camera-stream'),
    takePictureBtn: document.getElementById('take-picture-btn'),
    imageUploader: document.getElementById('image-uploader'),
    gameMessage: document.getElementById('game-message'),
    playerGuessingControls: document.getElementById('player-guessing-controls'),
    playerGuessInput: document.getElementById('player-guess-input'),
    submitGuessBtn: document.getElementById('submit-guess-btn'),
    micBtn: document.getElementById('mic-btn'),
    aiGuessingControls: document.getElementById('ai-guessing-controls'),
    aiGuessCorrectBtn: document.getElementById('ai-guess-correct-btn'),
    aiGuessWrongBtn: document.getElementById('ai-guess-wrong-btn'),
    newRoundControls: document.getElementById('new-round-controls'),
    newRoundBtn: document.getElementById('new-round-btn'),
    loadingSpinner: document.getElementById('loading-spinner'),
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

let state = {
    turn: 'ai', // 'ai' or 'player'
    phase: 'setup', // 'setup', 'spying', 'guessing', 'reveal'
    scores: { player: 0, ai: 0 },
    guessesLeft: 5,
    spiedObject: null,
    spiedClue: null,
    imageData: null,
    aiGuessedItems: [],
    stream: null, // To hold the camera stream
};

function setState(newState) {
    Object.assign(state, newState);
    renderUI();
}

function renderUI() {
    dom.playerScore.textContent = state.scores.player;
    dom.aiScore.textContent = state.scores.ai;

    dom.imagePlaceholder.style.display = state.imageData || state.stream ? 'none' : 'flex';
    dom.gameImage.style.display = state.imageData ? 'block' : 'none';
    dom.gameImage.src = state.imageData || '';
    dom.cameraStream.style.display = state.stream && !state.imageData ? 'block' : 'none';
    dom.takePictureBtn.style.display = state.stream && !state.imageData ? 'block' : 'none';

    dom.playerGuessingControls.style.display = state.phase === 'guessing' && state.turn === 'ai' ? 'flex' : 'none';
    dom.aiGuessingControls.style.display = state.phase === 'guessing' && state.turn === 'player' ? 'flex' : 'none';
    dom.newRoundControls.style.display = state.phase === 'reveal' ? 'flex' : 'none';

    dom.loadingSpinner.style.display = state.phase === 'spying' ? 'block' : 'none';

    if (state.phase === 'spying') {
        dom.playerGuessingControls.style.display = 'none';
        dom.aiGuessingControls.style.display = 'none';
    }
}

async function startCamera() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            dom.cameraStream.srcObject = stream;
            setState({ stream: stream });
        } catch (err) {
            console.error("Error accessing camera: ", err);
            dom.gameMessage.textContent = "Could not access the camera. Please check permissions and try again.";
        }
    } else {
        dom.gameMessage.textContent = "Your browser does not support camera access.";
    }
}

function takePicture() {
    const canvas = document.createElement('canvas');
    canvas.width = dom.cameraStream.videoWidth;
    canvas.height = dom.cameraStream.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(dom.cameraStream, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg');

    // Stop the camera stream
    state.stream.getTracks().forEach(track => track.stop());

    setState({ imageData: dataUrl, stream: null });

    if (state.turn === 'ai') {
        startAiTurn();
    } else {
        startPlayerTurn();
    }
}

async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
        setState({ imageData: e.target.result });
        if (state.turn === 'ai') {
            startAiTurn();
        } else {
            startPlayerTurn();
        }
    };
    reader.readAsDataURL(file);
}

async function startAiTurn() {
    setState({ phase: 'spying', guessesLeft: 5, spiedObject: null, spiedClue: null });
    dom.gameMessage.textContent = "AI is looking at the image to spy something...";

    try {
        const completion = await websim.chat.completions.create({
            messages: [{
                role: 'system',
                content: `You are playing "I Spy". Look at the image and choose a single, common, clearly visible object. Provide the object's name and a simple clue, like its color or a one-word description. Respond with a JSON object: {"object": "object name", "clue": "clue (e.g., a color)"}.`
            }, {
                role: 'user',
                content: [{ type: 'image_url', image_url: { url: state.imageData } }]
            }],
            json: true,
        });
        const { object, clue } = JSON.parse(completion.content);
        setState({ spiedObject: object, spiedClue: clue, phase: 'guessing' });
        dom.gameMessage.textContent = `I spy with my little eye, something that is ${clue}. You have 5 guesses!`;
    } catch (error) {
        console.error("AI spying failed:", error);
        dom.gameMessage.textContent = "The AI had trouble picking an object. Please try another image.";
        setState({ phase: 'setup', imageData: null });
    }
}

async function handlePlayerGuess() {
    const guess = dom.playerGuessInput.value.trim();
    if (!guess) return;

    dom.playerGuessInput.disabled = true;
    dom.submitGuessBtn.disabled = true;
    dom.micBtn.disabled = true;

    try {
        const completion = await websim.chat.completions.create({
            messages: [{
                role: 'system',
                content: `The user is guessing an object in an "I Spy" game. The correct object is "${state.spiedObject}". The user guessed "${guess}". Determine if the guess is correct. The guess can be a synonym or a close description. Respond with JSON: {"correct": boolean}.`
            }],
            json: true,
        });
        const { correct } = JSON.parse(completion.content);

        if (correct) {
            dom.gameMessage.textContent = `You got it! The object was "${state.spiedObject}". You win this round!`;
            setState({ scores: { ...state.scores, player: state.scores.player + 1 }, phase: 'reveal' });
        } else {
            state.guessesLeft--;
            if (state.guessesLeft > 0) {
                dom.gameMessage.textContent = `Nope, not a ${guess}. You have ${state.guessesLeft} guesses left.`;
                setState({}); // re-render
            } else {
                dom.gameMessage.textContent = `You're out of guesses! The object was "${state.spiedObject}". The AI wins this round.`;
                setState({ scores: { ...state.scores, ai: state.scores.ai + 1 }, phase: 'reveal' });
            }
        }
    } catch (error) {
        console.error("Error checking guess:", error);
        dom.gameMessage.textContent = "Sorry, I had trouble understanding that guess. Try again.";
    }

    dom.playerGuessInput.value = '';
    dom.playerGuessInput.disabled = false;
    dom.submitGuessBtn.disabled = false;
    dom.micBtn.disabled = false;
}

function startPlayerTurn() {
    setState({ phase: 'spying', guessesLeft: 5, aiGuessedItems: [] });
    dom.gameMessage.textContent = "Your turn! Think of an object in the image. The AI will start guessing.";
    setTimeout(handleAIGuess, 2000); // Give player time to think
}

async function handleAIGuess() {
    setState({ phase: 'guessing' });
    dom.gameMessage.textContent = "AI is thinking of a guess...";

    try {
        const completion = await websim.chat.completions.create({
            messages: [{
                role: 'system',
                content: `You are playing "I Spy". Look at the image and guess one common object. You have been told that these previous guesses were wrong: ${JSON.stringify(state.aiGuessedItems)}. Do not guess them again. Respond with JSON: {"guess": "object name"}.`
            }, {
                role: 'user',
                content: [{ type: 'image_url', image_url: { url: state.imageData } }]
            }],
            json: true
        });
        const { guess } = JSON.parse(completion.content);
        state.aiGuessedItems.push(guess);
        dom.gameMessage.textContent = `AI's guess: Is it a ${guess}?`;
        setState({});
    } catch (error) {
        console.error("AI guessing failed:", error);
        dom.gameMessage.textContent = "The AI is having trouble. Let's try that again.";
        setTimeout(handleAIGuess, 2000);
    }
}

function handleAiGuessResponse(isCorrect) {
    if (isCorrect) {
        const lastGuess = state.aiGuessedItems[state.aiGuessedItems.length - 1];
        dom.gameMessage.textContent = `The AI guessed it! It was a ${lastGuess}. AI wins this round.`;
        setState({ scores: { ...state.scores, ai: state.scores.ai + 1 }, phase: 'reveal' });
    } else {
        state.guessesLeft--;
        if (state.guessesLeft > 0) {
            dom.gameMessage.textContent = `OK, not that one. The AI has ${state.guessesLeft} guesses left.`;
            setState({});
            setTimeout(handleAIGuess, 2000);
        } else {
            dom.gameMessage.textContent = "The AI is out of guesses! You win this round!";
            setState({ scores: { ...state.scores, player: state.scores.player + 1 }, phase: 'reveal' });
        }
    }
}

function startNewRound() {
    const nextTurn = state.turn === 'ai' ? 'player' : 'ai';
    setState({
        turn: nextTurn,
        phase: 'setup',
        imageData: null,
        stream: null,
    });
    if (nextTurn === 'ai') {
        dom.gameMessage.textContent = "New round! It's the AI's turn. Use your camera to show me the room.";
    } else {
        dom.gameMessage.textContent = "New round! It's your turn. Use your camera and think of an object.";
    }
}

function setupEventListeners() {
    dom.startCameraBtn.addEventListener('click', startCamera);
    dom.takePictureBtn.addEventListener('click', takePicture);

    dom.imageUploader.addEventListener('change', handleImageUpload);
    dom.submitGuessBtn.addEventListener('click', handlePlayerGuess);
    dom.playerGuessInput.addEventListener('keyup', (e) => e.key === 'Enter' && handlePlayerGuess());

    dom.aiGuessCorrectBtn.addEventListener('click', () => handleAiGuessResponse(true));
    dom.aiGuessWrongBtn.addEventListener('click', () => handleAiGuessResponse(false));

    dom.newRoundBtn.addEventListener('click', startNewRound);

    if (recognition) {
        dom.micBtn.addEventListener('click', () => {
            recognition.start();
            dom.micBtn.classList.add('active');
            dom.micBtn.querySelector('img').src = 'microphone-active.png';
        });

        recognition.addEventListener('result', (e) => {
            const transcript = Array.from(e.results)
                .map(result => result[0])
                .map(result => result.transcript)
                .join('');
            dom.playerGuessInput.value = transcript;
        });
        
        recognition.addEventListener('end', () => {
            dom.micBtn.classList.remove('active');
            dom.micBtn.querySelector('img').src = 'microphone.png';
            if (dom.playerGuessInput.value) {
                handlePlayerGuess();
            }
        });
    } else {
        dom.micBtn.style.display = 'none';
    }
}

// Initial setup
renderUI();
setupEventListeners();