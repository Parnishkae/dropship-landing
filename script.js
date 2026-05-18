document.getElementById("product-title").textContent =
  product.title;

document.getElementById("product-subtitle").textContent =
  product.subtitle;

const mainImage =
  document.getElementById("main-image");

mainImage.src =
  product.images[0];



const thumbnails =
  document.getElementById("thumbnails");



product.images.forEach(image => {

  const thumb =
    document.createElement("img");

  thumb.src = image;

  thumb.classList.add("thumb");



  thumb.addEventListener("click", () => {

    mainImage.src = image;

  });



  thumbnails.appendChild(thumb);

});



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
