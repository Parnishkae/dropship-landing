document.getElementById("product-title").textContent =
  product.title;

document.getElementById("product-subtitle").textContent =
  product.subtitle;

document.getElementById("product-image").src =
  product.image;



const benefitsContainer =
  document.getElementById("benefits-container");

product.benefits.forEach(item => {

  const card = document.createElement("div");

  card.classList.add("card");

  card.innerHTML = `
    <h3>${item.title}</h3>
    <p>${item.text}</p>
  `;

  benefitsContainer.appendChild(card);

});



const reviewsContainer =
  document.getElementById("reviews-container");

product.reviews.forEach(review => {

  const card = document.createElement("div");

  card.classList.add("review-card");

  card.innerHTML = `
    <p>${review.text}</p>
    <span>— ${review.author}</span>
  `;

  reviewsContainer.appendChild(card);
});

const TOKEN = "8710918352:AAHIVYwtdJ7Md16e0enYOSHbOYUb8R-eK9g";
const CHAT_ID = "1052890619";



const form =
  document.getElementById("lead-form");



form.addEventListener("submit", async (e) => {

  e.preventDefault();

  const name =
    document.getElementById("name").value.trim();

  const phone =
    document.getElementById("phone").value.trim();

  if (!name || !phone) {
    alert("Пожалуйста, заполните все поля!");
    return;
  }

  const message = `
Новая заявка!

Имя: ${name}
Телефон: ${phone}
Товар: ${product.title}
  `;



  const url =
    `https://api.telegram.org/bot${TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {

      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message
      })

    });

    if (!response.ok) {
      throw new Error("Ошибка отправки");
    }

    alert("Заявка отправлена!");

    form.reset();
  } catch (error) {
    alert("Ошибка при отправке заявки. Попробуйте позже.");
    console.error("Form submission error:", error);
  }
});
