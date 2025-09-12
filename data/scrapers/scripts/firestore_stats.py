from util.firestore import path_occurrence

if __name__ == "__main__":
    paths, collections = path_occurrence()
    print(paths)