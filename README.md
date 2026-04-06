# 🎬 VideoCutterApp

A powerful, user-friendly tool for splitting and cutting videos using a React frontend and Node.js backend. This application allows you to easily process video files, selecting specific segments to crop and save.

![VideoCutterApp Preview](https://images.unsplash.com/photo-1542281286-9e0a16bb7366?q=80&w=2070&auto=format&fit=crop)

---

## ⚡ Features

- **🚀 Instant Splitting**: Quickly cut through high-resolution video files.
- **🎨 Modern UI**: Clean, responsive interface built with React and TailwindCSS.
- **🛠️ Backend Processing**: Fast processing handled by a Node.js server.
- **📦 Effortless Setup**: Automatic dependencies installation and system launch using a single batch script ($launch\_system.bat$).

---

## 🛠️ Tech Stack

- **Frontend**: [React.js](https://reactjs.org/), [Vite](https://vitejs.dev/), [TailwindCSS](https://tailwindcss.com/)
- **Backend**: [Node.js](https://nodejs.org/), [Express](https://expressjs.com/)
- **Icons**: [Lucide React](https://lucide.dev/)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (Latest LTS recommended)
- [FFmpeg](https://ffmpeg.org/) (Ensure it's installed and added to your system path)

### Installation & Launch (Windows)

The simplest way is to use the provided launch script, which automatically installs dependencies and starts both the frontend and backend servers.

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd VideoCutterApp
    ```

2.  **Run the launch script:**
    Double-click `launch_system.bat` or run:
    ```powershell
    .\launch_system.bat
    ```

3.  **Access the application:**
    - **Frontend:** [http://localhost:5173](http://localhost:5173) (default Vite port)
    - **Backend:** [http://localhost:5000](http://localhost:5000)

---

## 📂 Project Structure

```text
VideoCutterApp/
├── backend/            # Express.js Server
│   ├── uploads/        # Temporary storage for uploaded videos
│   ├── output/         # Processed video clips
│   └── server.js       # Main server logic
├── frontend/           # React + Vite Application
│   ├── src/            # Components, styles, and logic
│   └── public/         # Static assets
└── launch_system.bat   # Windows initialization & launch script
```

---

## 🛠️ Manual Start

If you prefer to run the servers separately:

**1. Start Backend:**
```bash
cd backend
npm install
node server.js
```

**2. Start Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## 🤝 Contributing

Feel free to fork the repository and submit pull requests. All contributions are welcome!

---

## 📜 License

This project is licensed under the MIT License.
