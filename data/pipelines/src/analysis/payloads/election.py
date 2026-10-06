def get_election_type(election_type: str) -> str:
    # TODO this should be well typed
    match election_type.lower():
        case "sejmu":
            return "Sejm"
        case "senatu":
            return "Senat"
        case "prezydenckie":
            return "Prezydent"
        case "samorządu":
            return "Samorząd"
        case "europarlamentu":
            return "Parlament Europejski"

    raise ValueError(f"Unknown election type: {election_type}")
