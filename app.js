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

  // Lese die Fragen zuerst aus der JSON-Datei
  const questionsPath = path.join(__dirname, 'data', 'this_check', 'questions.json');
  questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

  // Schuffle die Fragen
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]]; // ES6 destructuring assignment for swapping
  }

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
  const emailPrefix = req.session.email.split('@')[0];
  const filePath = path.join(__dirname, 'data', 'this_check', `${emailPrefix}.json`);
  const quizData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const totalScore = evaluateQuiz(quizData);
      
  const startTime = new Date(quizData.meta.starttime);
  const endTime = new Date();
  const duration = Math.floor((endTime - startTime) / 1000); // Dauer in Sekunden
  const email = quizData.meta.email;

    res.json({
        email:email,
        start:startTime,
        ende:endTime,
        duration: duration,
        totalQuestions: quizData.questions.length,
        totalScore: totalScore
    }); 
    
});

app.get('/result', checkAuthentication, (req, res) => {

    res.render('result', {
        email:req.query.email,
        start:req.query.start,
        ende:req.query.ende,
        duration: req.query.duration,
        totalQuestions: req.query.totalQuestions,
        totalScore: req.query.totalScore
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
    const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const csvFilePath = path.join(__dirname, 'data', `ergebnisse${currentDate}.csv`);

    // Überprüfe, ob die CSV-Datei existiert
    if (!fs.existsSync(csvFilePath)) {
        // Wenn die CSV-Datei nicht existiert, erstelle die Überschrift
        fs.writeFileSync(csvFilePath, 'Mail,Klasse,Start,Ende,Punkte,nFragen,freiwilligAnmelden\n');
    }

    // Erstelle einen CSV-Eintrag mit den gewünschten Daten
    const csvEntry = [
        quizData.meta.email,
        quizData.meta.class,
        new Date(quizData.meta.starttime).toISOString(),
        new Date().toISOString(),
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
