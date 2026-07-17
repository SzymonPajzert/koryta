import os

from dotenv import load_dotenv

username = None


def get_username():
    global username
    if username is not None:
        return username

    load_dotenv()
    user = os.getenv("USERNAME")
    if user:
        username = user
        return user

    print("USERNAME environment variable not set. Please set it in .env file.")
    user = os.environ.get("USER", "")
    if user != "":
        confirmation = input(
            f"Should we use the system username '{user}' instead? (y/n): "
        )
        if confirmation.lower() == "y":
            username = user
            return user

    raise ValueError("USERNAME environment variable not set")
