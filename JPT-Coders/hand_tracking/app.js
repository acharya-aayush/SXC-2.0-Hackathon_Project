const video = document.getElementById('video');
const movementDisplay = document.getElementById('movement');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const cupInfo = document.getElementById('cup-info'); // Add this line

let handCenter = null; // Store the center of the hand
const PIXELS_PER_CM = 37.7952755906; // Conversion factor from pixels to centimeters
let lastSpeakTime = 0; // Track the last time the sound was played
const SPEAK_INTERVAL = 4000; // Interval in milliseconds (5 seconds)

// Function to start webcam stream
async function startWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        console.log("Webcam stream started");
    } catch (err) {
        console.error("Error accessing webcam:", err);
        alert("Webcam access denied or not available. Please allow access to your webcam.");
    }
}

// Load the handpose and COCO-SSD models
async function setupDetection() {
    try {
        await startWebcam(); // Ensure webcam starts before tracking

        // Load both models
        const handposeModel = await handpose.load();
        const cocoSsdModel = await cocoSsd.load();
        console.log("Handpose and COCO-SSD models loaded");

        // Start detection loops
        detectHandMovement(handposeModel);
        detectObjects(cocoSsdModel);
    } catch (err) {
        console.error("Error setting up detection:", err);
        alert("Failed to load the models. Please check your internet connection.");
    }
}

// Function to track hand movement and draw landmarks
async function detectHandMovement(model) {
    let lastHandPosition = null;

    async function detect() {
        // Clear the canvas before drawing new landmarks
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const predictions = await model.estimateHands(video);
        console.log("Hand predictions:", predictions); // Log predictions for debugging

        if (predictions.length > 0) {
            const landmarks = predictions[0].landmarks;

            // Draw hand landmarks (red circles)
            for (let i = 0; i < landmarks.length; i++) {
                const [x, y] = landmarks[i];
                const mirroredX = canvas.width - x; // Mirror the x-coordinate
                ctx.beginPath();
                ctx.arc(mirroredX, y, 5, 0, 2 * Math.PI); // Draw a circle at each landmark
                ctx.fillStyle = 'red';
                ctx.fill();
            }

            // Draw lines connecting the landmarks to form a mesh (green lines)
            const connections = [
                [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
                [0, 5], [5, 6], [6, 7], [7, 8], // Index finger
                [5, 9], [9, 10], [10, 11], [11, 12], // Middle finger
                [9, 13], [13, 14], [14, 15], [15, 16], // Ring finger
                [13, 17], [17, 18], [18, 19], [19, 20], // Pinky finger
                [0, 17] // Palm base
            ];

            ctx.strokeStyle = 'green';
            ctx.lineWidth = 2;
            connections.forEach(([start, end]) => {
                const [startX, startY] = landmarks[start];
                const [endX, endY] = landmarks[end];
                const mirroredStartX = canvas.width - startX; // Mirror the start x-coordinate
                const mirroredEndX = canvas.width - endX; // Mirror the end x-coordinate
                ctx.beginPath();
                ctx.moveTo(mirroredStartX, startY);
                ctx.lineTo(mirroredEndX, endY);
                ctx.stroke();
            });

            // Calculate the center of the hand
            const centerX = landmarks.reduce((sum, point) => sum + point[0], 0) / landmarks.length;
            const centerY = landmarks.reduce((sum, point) => sum + point[1], 0) / landmarks.length;
            const centerZ = landmarks.reduce((sum, point) => sum + point[2], 0) / landmarks.length;
            const mirroredCenterX = canvas.width - centerX; // Mirror the center x-coordinate
            handCenter = { x: mirroredCenterX, y: centerY, z: centerZ }; // Update hand center

            if (lastHandPosition) {
                const distance = Math.sqrt(
                    Math.pow(mirroredCenterX - lastHandPosition.x, 2) +
                    Math.pow(centerY - lastHandPosition.y, 2)
                );
                movementDisplay.textContent = `Movement detected! Distance: ${distance.toFixed(2)}px`;
            }
            lastHandPosition = { x: mirroredCenterX, y: centerY, z: centerZ };
        } else {
            movementDisplay.textContent = 'No hand detected.';
            handCenter = null; // Reset hand center if no hand is detected
        }

        // Repeat the detection
        requestAnimationFrame(detect);
    }

    // Start the detection loop
    detect();
}

// Function to detect objects
async function detectObjects(model) {
    async function detect() {
        const predictions = await model.detect(video);
        console.log("Object predictions:", predictions); // Log predictions for debugging

        // Clear the canvas before drawing new bounding boxes
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw bounding boxes and labels for each prediction
        predictions.forEach(prediction => {
            if (prediction.class === 'cup') {
                const [x, y, width, height] = prediction.bbox;
                const mirroredX = canvas.width - x - width; // Mirror the x-coordinate of the bounding box

                ctx.strokeStyle = 'blue';
                ctx.lineWidth = 2;
                ctx.strokeRect(mirroredX, y, width, height);

                ctx.fillStyle = 'blue';
                ctx.font = '18px Arial';
                ctx.fillText(
                    `${prediction.class} (${Math.round(prediction.score * 100)}%)`,
                    mirroredX,
                    y > 10 ? y - 5 : 10
                );

                // Calculate the center of the object
                const objectCenterX = mirroredX + width / 2;
                const objectCenterY = y + height / 2;
                const objectCenterZ = 0; // Fixed z-coordinate for the cup

                // Calculate the distance between the hand center and the object center
                if (handCenter) {
                    const distancePx = Math.sqrt(
                        Math.pow(objectCenterX - handCenter.x, 2) +
                        Math.pow(objectCenterY - handCenter.y, 2)
                    );
                    const distanceCm = distancePx / PIXELS_PER_CM;

                    // Draw a line between the hand center and the object center
                    ctx.strokeStyle = 'yellow';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(handCenter.x, handCenter.y);
                    ctx.lineTo(objectCenterX, objectCenterY);
                    ctx.stroke();

                    // Determine the relative position of the cup with respect to the hand
                    let relativePosition = '';
                    const handVisible = predictions.length > 0; // Check if hand is visible
                    if (Math.abs(objectCenterX - handCenter.x) < 10 && Math.abs(objectCenterY - handCenter.y) < 10) {
                        if (handCenter.z < objectCenterZ || !handVisible) {
                            relativePosition = 'front';
                        } else {
                            relativePosition = 'back';
                        }
                    } else if (Math.abs(objectCenterX - handCenter.x) < 10 && objectCenterY > handCenter.y) {
                        relativePosition = 'straight down';
                    } else if (objectCenterX < handCenter.x && Math.abs(objectCenterY - handCenter.y) < 10) {
                        relativePosition = 'left';
                    } else if (objectCenterX > handCenter.x && Math.abs(objectCenterY - handCenter.y) < 10) {
                        relativePosition = 'right';
                    } else {
                        if (objectCenterX < handCenter.x) {
                            relativePosition += 'left ';
                        } else if (objectCenterX > handCenter.x) {
                            relativePosition += 'right ';
                        }
                        if (objectCenterY < handCenter.y) {
                            relativePosition += 'up';
                        } else if (objectCenterY > handCenter.y) {
                            relativePosition += 'down';
                        }
                    }

                    // Display the relative position at the bottom of the canvas
                    ctx.fillStyle = 'white';
                    ctx.font = '18px Arial';
                    ctx.fillText(
                        `Cup is ${relativePosition.trim()} of the hand`,
                        canvas.width / 2,
                        canvas.height - 10
                    );

                    // Use text-to-speech to announce the position if the interval has passed
                    const currentTime = Date.now();
                    if (currentTime - lastSpeakTime > SPEAK_INTERVAL) {
                        speak(`Cup is ${relativePosition.trim()} of the hand`);
                        lastSpeakTime = currentTime;
                    }

                    console.log(`Distance between hand and cup: ${distanceCm.toFixed(2)} cm, Position: ${relativePosition.trim()}`);
                }
            }
        });

        // Repeat the detection
        requestAnimationFrame(detect);
    }

    // Start the detection loop
    detect();
}

// Function to convert text to speech
function speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(voice => voice.name.includes('Google UK English Female') || voice.name.includes('Microsoft Zira') || voice.gender === 'female');
    if (femaleVoice) {
        utterance.voice = femaleVoice;
    }
    utterance.pitch = 1.5; // Increase pitch to make the voice sound sweeter
    utterance.rate = 1.0; // Set a moderate rate for clarity
    window.speechSynthesis.speak(utterance);
}

// Start the detection process
setupDetection().catch(err => console.error("Error setting up detection:", err));