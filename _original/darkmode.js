const themeToggle = document.getElementById("theme-input");
const theme = localStorage.getItem('theme');
const sunDark = document.getElementById("imgSunDark");
const moonDark= document.getElementById("imgMoonDark");


const MQMobile = window.matchMedia("(min-width: 1px)");
const MQTablet = window.matchMedia("(min-width: 768px)");
const MQDesktop = window.matchMedia("(min-width: 992px)");

function updateBackgroundImage() {
    const isDarkMode = document.body.classList.contains("dark-mode");

    if (MQDesktop.matches) {
        document.body.style.backgroundImage = isDarkMode 
            ? "url('img/pattern-background-desktop-dark.svg')" 
            : "url('img/pattern-background-desktop-light.svg')";
    } else if (MQTablet.matches) {
        document.body.style.backgroundImage = isDarkMode 
            ? "url('img/pattern-background-tablet-dark.svg')" 
            : "url('img/pattern-background-tablet-light.svg')";
    } else if (MQMobile.matches) {
        document.body.style.backgroundImage = isDarkMode 
            ? "url('img/pattern-background-mobile-dark.svg')" 
            : "url('img/pattern-background-mobile-light.svg')";
    }
}

MQMobile.addEventListener('change', updateBackgroundImage);
MQTablet.addEventListener('change', updateBackgroundImage);
MQDesktop.addEventListener('change', updateBackgroundImage);


updateBackgroundImage();

if (theme == 'dark-mode') {
    document.body.classList.add("dark-mode");
    updateBackgroundImage();
    sunDark.classList.add("filterSunDark");
    moonDark.classList.add("filterMoonDark");
    themeToggle.classList.add("checked1");
} else {
    updateBackgroundImage();
    themeToggle.classList.remove("checked1");
    sunDark.classList.remove("filterSunDark");
    moonDark.classList.remove("filterMoonDark");
}


themeToggle.addEventListener('change', function() {
    document.body.classList.toggle("dark-mode");
    document.body.classList.toggle("backgroundImgDark");
    moonDark.classList.toggle("filterMoonDark");
    sunDark.classList.toggle("filterSunDark");
    themeToggle.classList.toggle("checked1");

    if (document.body.classList.contains("dark-mode")) {
        localStorage.setItem('theme', 'dark-mode');
    } else {
        localStorage.removeItem('theme', 'dark-mode');
    }
    updateBackgroundImage();
});


