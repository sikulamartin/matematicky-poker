  const originalNumbers = [
    1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4,
    5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8,
    9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12,
    13, 13, 13, 13, 'x', 'x'
  ];
  
  let remainingNumbers = [];
  let maxRolls = 25;
  let lastGeneratedNumber = null;
  let storedXValues = [];
  
  function resetNumbers() {
    remainingNumbers = originalNumbers.slice();
    shuffleArray(remainingNumbers);
  }
  
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
  
  function rollDice() {  
    if (remainingNumbers.length === 0) {
      return null;
    }
  
    const result = remainingNumbers.pop();
  
  
    return result;
  }
  
  
  function resetTable() {
    const cells = document.querySelectorAll('#bonusTable tbody td');
    cells.forEach(cell => {
      cell.textContent = '';
      cell.removeAttribute('disabled');
    });
    resetNumbers();
    rollCount = 0;
    rollButton.textContent = 'Generovat';
    rollButton.classList.remove('disabled');
    rollButton.disabled = false;
  }
  
  const rollButton = document.getElementById('rollButton');
  const resultDisplay = document.getElementById('result-display');
  const resultDisplay1 = document.getElementById('result-display1');
  const resultDisplay2 = document.getElementById('result-display2');
  const hiddenResultDisplay = document.getElementById('hidden-result-display');
  let rollCount = 0;
  
  resetNumbers();
  
  rollButton.addEventListener('click', function () {
    if (rollButton.textContent === 'Hrát znovu') {
      resetTable();
      return;
    }
  
    rollCount++;
    if (rollCount > maxRolls) {
      rollCount = 1;
      resetNumbers();
    }
    const result = rollDice();
    if (result !== null) {
      rollButton.style.padding = "28px 42px";
      hiddenResultDisplay.style.display = "inline-block";
      resultDisplay.textContent = `${rollCount}`;
      resultDisplay1.textContent = `${result}`;
      lastGeneratedNumber = result;
    } else {
      resultDisplay.textContent = `Už nejsou žádná další čísla k dispozici.`;
    }
    if (rollCount >= maxRolls - storedXValues.length) {
      handleStoredXValues();
      rollButton.textContent = 'Hrát znovu';
      rollButton.classList.add('disabled');
      rollButton.disabled = false;
    }
  });
  

  
  function handleStoredXValues() {
    while (storedXValues.length > 0) {
      const value = prompt("Zadejte hodnotu pro 'x':");
      if (value !== null && value !== '') {
        storedXValues.shift();
        maxRolls--;
        lastGeneratedNumber = value;
        return value;
      } else {
        alert("Zadejte platnou hodnotu!");
      }
    }
    return null;
  }
  
  
  setInterval(() => {
    const cells = document.querySelectorAll("td[contenteditable]");
    cells.forEach(cell => {
      checkCell(cell);
    });
  }, 100);