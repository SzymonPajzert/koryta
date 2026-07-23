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


def pick_user(username: str, userlist: list[str]) -> str:
    if username in userlist:
        return username
    elif len(userlist) == 1:
        chosen_user = next(iter(userlist))
        print(f"Using only available user: '{chosen_user}'")
        return chosen_user
    else:
        users = sorted(userlist)
        print("Available users:")
        for i, u in enumerate(users):
            print(f"  [{i}] {u}")
        choice = input("Select user number: (or 'q' to quit):").strip()
        if choice.lower() == "q":
            raise ValueError("User selection aborted by the user.")
        try:
            chosen_user = users[int(choice)]
            return chosen_user
        except (ValueError, IndexError):
            raise FileNotFoundError("Invalid selection")
