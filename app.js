const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const app = express();
const port = 3000;

const SECRET_CODE = "ABCDE"; // Der echte Code soll geheim gehalten und hier ersetzt werden

app.use(express.static(__dirname));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({extended: false}));

app.use(session({
  secret: 'abcd1234+"*!', // This should be a secure secret
  resave: false,
  saveUninitialized: true,
}));

let currentQuestionIndex = 0;
let questions = [];

// Middleware to check authentication
function checkAuthentication(req, res, next) {
  if (req.session.isAuthenticated) {
    next(); // If authenticated, proceed to next middleware
  } else {
    res.redirect('/'); // If not authenticated, redirect to login
  }
}

app.post('/register', (req, res) => {
  const { email, accessCode, freiwilligAnmelden } = req.body;
  const isFreiwilligAnmelden = (freiwilligAnmelden === 'true');
    

  // Überprüfe den Zugangscode
  if (accessCode !== SECRET_CODE) {
    res.json({ error: 'Der Zugangscode ist nicht korrekt.' });
    return;
  }

  req.session.isAuthenticated = true; // Set the user as authenticated
  req.session.email = email; // Store the email in the session
  req.session.lastQuestionSeen = false; 
  req.session.startTime = new Date().toISOString();

  // Lese die Fragen zuerst aus der JSON-Datei
  const questionsPath = path.join(__dirname, 'data', 'this_check', 'questions.json');
  questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

  // Schuffle die Fragen
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]]; // ES6 destructuring assignment for swapping
  }
    
  // Shuffle die Optionen für jede Frage
  questions.forEach(question => {
    const options = question.options;
    for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
    }
  });

  // Füge den "seen" und "ans" Felder hinzu
  questions = questions.map(question => {
    question.options = question.options.map(option => {
      option.ans = false; // Füge "ans" Feld zu jeder Option hinzu
      return option;
    });
    return question;
  });
    
  // Erstelle das zu speichernde Objekt
  const toSave = {
    meta: {
        ...req.body,
        freiwilligAnmelden: isFreiwilligAnmelden,
        starttime: new Date().toISOString() // aktuelle Uhrzeit
    },
    questions
  };

  // Erstelle eine neue JSON-Datei im gewünschten Ordner
  const emailPrefix = email.split('@')[0];
  fs.writeFileSync(path.join(__dirname, 'data', 'this_check', `${emailPrefix}.json`), JSON.stringify(toSave));

  // Wähle die erste Frage aus
  currentQuestionIndex = 0;
  renderQuestion(req, res, currentQuestionIndex);
});

app.get('/next', checkAuthentication, (req, res) => {
  if (currentQuestionIndex < questions.length - 1) {
    currentQuestionIndex++;
  }
  renderQuestion(req, res, currentQuestionIndex);
});

app.get('/prev', checkAuthentication, (req, res) => {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex--;
  }
  renderQuestion(req, res, currentQuestionIndex);
});

app.get('/ikt-check', checkAuthentication, (req, res) => {
  renderQuestion(req, res, currentQuestionIndex);
});

app.get('/ikt-check/:id', checkAuthentication, (req, res) => {
  const index = req.params.id;
  renderQuestion(req, res, index);
});

function renderQuestion(req, res, index) {
  const emailPrefix = req.session.email.split('@')[0];
  const filepath = path.join(__dirname, 'data', 'this_check', `${emailPrefix}.json`);

  // Prüfe, ob die Datei existiert
  if (fs.existsSync(filepath)) {
    // Lese die JSON-Datei
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    
    // Überprüfen Sie, ob die aktuelle Frage die letzte ist
    if (index == data.questions.length - 1){
        req.session.lastQuestionSeen = true;
    };  
      
    // Hole die aktuelle Frage
    const question = data.questions[index];  

    // Rendere die "check"-Ansicht mit der aktuellen Frage, E-Mail und Index
    res.render('check', { question: question, email: req.session.email, currentQuestionIndex: index, n: data.questions.length, lastQuestionSeen: req.session.lastQuestionSeen });
  } else {
    // Falls die Datei nicht existiert, leite den Benutzer zur Anfangsseite um oder zeige eine Fehlermeldung
    res.redirect('/');
  }       
}

app.post('/update', (req, res) => {
  const { questionIndex, optionIndex, checked } = req.body;

  // Get the user's email from the session
  const email = req.session.email;

  // Read the user's JSON file
  const emailPrefix = email.split('@')[0];
  const filePath = path.join(__dirname, 'data', 'this_check', `${emailPrefix}.json`);
  const userData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Update the "ans" field of the option
  userData.questions[questionIndex].options[optionIndex].ans = checked;

  // Write the updated data back to the file
  fs.writeFileSync(filePath, JSON.stringify(userData));

  res.json({ success: 'Frage wurde erfolgreich aktualisiert.' });
});


app.post('/submit', checkAuthentication, (req, res) => {
  const { questionIndex, optionIndex, checked } = req.body;
  const emailPrefix = req.session.email.split('@')[0];
  const filePath = path.join(__dirname, 'data', 'this_check', `${emailPrefix}.json`);
  const quizData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  // Update the "ans" field of the option
  quizData.questions[questionIndex].options[optionIndex].ans = checked;
    
  const totalScore = evaluateQuiz(quizData);
  req.session.totalScore = totalScore;
  quizData.meta.totalScore = totalScore; 
  quizData.meta.endTime = new Date(); 
  // Write the updated data back to the file
  fs.writeFileSync(filePath, JSON.stringify(quizData));    
  
  res.json({ success: 'IKT-Test wurde abgeschlossen.' });
    
});


app.get('/result', checkAuthentication, (req, res) => {
    console.log(req.session)
    const startTime = new Date(req.session.startTime);
    const endTime = new Date();
    const duration = Math.floor((endTime - startTime) / 1000)/60; // Dauer in Minuten
    // Falls benötigt, kann dieser Endpunkt verwendet werden, um die Ergebnisseite direkt anzuzeigen.
    res.render('result', {
        email: req.session.email,
        start: startTime.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }),
        ende: endTime.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }),
        duration: duration,  // Dauer in Sekunden, wenn Sie sie gespeichert haben
        totalQuestions: questions.length,
        totalScore: req.session.totalScore // Sie müssen den Gesamtscore in der Session speichern, um ihn hier zu verwenden
    });
});


function evaluateQuiz(quizData) {
    let totalScore = 0;

    // Gehe durch jede Frage in der Datenstruktur
    for (const question of quizData.questions) {
        let correctAnswers = 0;

        // Gehe durch jede Antwortoption und zähle die korrekten Antworten
        for (const option of question.options) {
            if (option.correct === (option.ans === "true")) {
                correctAnswers++;
            }
        }

        // Bewertung basierend auf der Anzahl der korrekten Antworten
        question.score = correctAnswers === question.options.length ? 1 :
                         correctAnswers === question.options.length - 1 ? 0.5 : 0;

        // Addiere zur Gesamtpunktzahl
        totalScore += question.score;
    }

    console.log("Abgabe von "+quizData.meta.email+"; Ergebnis: "+totalScore+" punkte; freiw. :"+quizData.meta.freiwilligAnmelden);

    // Erstelle den CSV-Dateinamen mit aktuellem Datum
    const currentDate = new Date(quizData.meta.starttime).toISOString().slice(0, 10).replace(/-/g, "");
    const csvFilePath = path.join(__dirname, 'data', `ergebnisse${currentDate}.csv`);

    // Überprüfe, ob die CSV-Datei existiert
    if (!fs.existsSync(csvFilePath)) {
        // Wenn die CSV-Datei nicht existiert, erstelle die Überschrift
        fs.writeFileSync(csvFilePath, 'Mail,Vorname,Nachname,Klasse,Datum,Start,Ende,Punkte,nFragen,freiwilligAnmelden\n');
    }

    // Extrahiere Vorname und Nachname aus der E-Mail-Adresse
    const emailParts = quizData.meta.email.split('@')[0].split('.');

    const vorname = emailParts[0];
    const nachname = emailParts.length > 1 ? emailParts[1] : "Mustermann"; // Wenn kein Punkt vorhanden ist, setzen Sie den Nachnamen auf "Mustermann"

    // Extrahiere und formatiere das Datum
    const date = new Date(quizData.meta.starttime).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Extrahiere und formatiere Start- und Endzeit auf MEZ
    const startTime = new Date(quizData.meta.starttime).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
    const endTime = new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });

    // Erstelle einen CSV-Eintrag mit den gewünschten Daten
    const csvEntry = [
        quizData.meta.email,
        vorname,
        nachname,
        quizData.meta.class,
        date,
        startTime,
        endTime,
        totalScore,
        quizData.questions.length,
        quizData.meta.freiwilligAnmelden
    ].join(',') + '\n';

    // Schreibe den CSV-Eintrag in die Datei
    fs.appendFileSync(csvFilePath, csvEntry);
    
    return totalScore;
}

app.get('/', (req, res) => {
  res.render('index');
});

app.listen(port, () => {
  console.log(`Server läuft auf http://localhost:${port}`);
});
